/**
 * Auto-save Module for the Cloud9 IDE. A simple plug-in that auto-saves files
 * the user is working on and potentially restores them in case the user
 * accidentally leaves the editor without saving.
 *
 * @author Sergi Mansilla <sergi AT ajax DOT org>
 * @copyright 2012, Ajax.org B.V.
 * @license GPLv3 <http://www.gnu.org/licenses/gpl.txt>
 */

define(function(require, exports, module) {

"use strict";

var ide = require("core/ide");
var ext = require("core/ext");
var fs = require("ext/filesystem/filesystem");
var Diff_Match_Patch = require("./diff_match_patch");
var markup = require("text!ext/autosave/autosave.xml");
var Save = require("ext/save/save");

var INTERVAL = 6000;
var FILE_SUFFIX = "c9save";

var getTempPath = function(originalPath) {
    var pathLeafs = originalPath.split("/");
    var last = pathLeafs.length - 1;

    pathLeafs[last] = "." + pathLeafs[last] + "." + FILE_SUFFIX;
    return pathLeafs.join("/");
};

var removeFile = function(path) {
    fs.exists(path, function(exists) {
        if (exists)
            fs.remove(path);
    });
};
/// test asd
var Diff = new Diff_Match_Patch();

module.exports = ext.register("ext/autosave/autosave", {
    dev: "Ajax.org",
    name: "Save",
    alone: true,
    type: ext.GENERAL,
    markup: markup,
    deps: [fs],
    offline: true,
    nodes: [],
    saveBuffer: {},
    undoStack: {},

    hook : function(){
        if (!tabEditors)
            return;

        var self = this;
        // This is the main interval. Whatever it happens, every `INTERVAL`
        // milliseconds, the plugin will attempt to save every file that is
        // open and dirty.

        // We might want to detect user "bursts" in writing and autosave after
        // those happen. Left as an exercise for the reader.
        this.autoSaveInterval = setInterval(function() {
            self.doAutoSave();
        }, INTERVAL);

        ide.addEventListener("afteropenfile", function(data) {
            if (!data || !data.doc)
                return;

            var doc = data.doc;
            var node = doc.getNode();
            var origPath = node.getAttribute("path");
            var bkpPath = getTempPath(node.getAttribute("path"));

            // If there is already a backup file
            fs.exists(bkpPath, function(exists) {
                var currentValue = doc.getValue();
                if (!exists) {
                    self.undoStack[origPath] = {
                        startValue: currentValue,
                        lastSavedContent: currentValue,
                        revisions: []
                    };
                    return;
                }

                fs.readFile(bkpPath, function(contents) {
                    if (contents) {
                        try {
                            self.undoStack[origPath] = JSON.parse(contents);
                            self.undoStack[origPath].lastSavedContent = currentValue;
                        }
                        catch (e) {}

                        console.log(self.undoStack[origPath]);
                    }
                });
            });
        });

        // Remove any temporary file after the user saves willingly.
        // ide.addEventListener("afterfilesave", function(obj) {
        //     removeFile(getTempPath(obj.node.getAttribute("path")));
        // });
    },

    init: function() {
        var resetWinAndHide = function() {
            winNewerSave.restoredContents = null;
            winNewerSave.doc = null;
            winNewerSave.path = null;
            winNewerSave.hide();
        };

        winNewerSave.onafterrender = function(){
            btnRestoreYes.addEventListener("click", function() {
                var contents = winNewerSave.restoredContents;
                winNewerSave.doc && winNewerSave.doc.setValue(contents);
                winNewerSave.path && removeFile(winNewerSave.path);
                resetWinAndHide();
            });


            btnRestoreNo.addEventListener("click", function() {
                // It is understood that if the user doesn't want to restore
                // contents from the previous file the first time, he will
                // never want to.
                winNewerSave.path && removeFile(winNewerSave.path);
                resetWinAndHide();
            });
        };
    },

    doAutoSave: function() {
        var pages = tabEditors.getPages();
        for (var i = 0, len = pages.length; i < len; i++) {
            this.saveTmp(pages[i]);
        }
    },

    saveTmp: function(page) {
        if (!page || !page.$at)
            page = tabEditors.getPage();

        if (!page)
            return;

        ext.initExtension(this);
        // Check to see if the page has been actually modified since the last
        // save.
        var model = page.getModel();
        if (model && model.data.getAttribute("changed") !== "1")
            return;

        var doc = page.$doc;
        var node = doc.getNode();
        if (/* for now */ node.getAttribute("newfile") ||
            node.getAttribute("debug")) {
            return;
        }

        var origPath = node.getAttribute("path");
        var panel = sbMain.firstChild;
        panel.setAttribute("caption", "Saving file " + origPath);

        var pathLeafs = origPath.split("/");
        var fileName = pathLeafs.pop();
        var dirName = pathLeafs.join("/");

        fileName = getTempPath(fileName);

        var self = this;
        var bkpPath = dirName + "/" + fileName;
        var value = doc.getValue();

        var lastContent, patch, diffText;
        if (this.undoStack[origPath]) {
            lastContent = this.undoStack[origPath].lastSavedContent;
            patch = Diff.patch_make(lastContent, doc.getValue());
            diffText = Diff.patch_toText(patch);
        }

        Save.quicksave(page, function() {
            var backup = self.undoStack[origPath];
            backup.lastSavedContent = value;
            backup.revisions.push(diffText);

            fs.saveFile(bkpPath, JSON.stringify(backup), function(data, state, extra) {
                if (state !== apf.SUCCESS) {
                    return;
                }
                console.log("Backup saved:", backup);
            });
        });

        return false;
    },

    enable : function(){
        this.nodes.each(function(item){
            item.enable();
        });
    },

    disable : function(){
        this.nodes.each(function(item){
            item.disable();
        });
    },

    destroy : function(){
        if (this.autoSaveInterval)
            clearInterval(this.autoSaveInterval);

        this.nodes.each(function(item){
            item.destroy(true, true);
        });
        this.nodes = [];
    }
});
});
