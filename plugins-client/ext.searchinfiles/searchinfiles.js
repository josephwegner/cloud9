/**
 * Searchinfiles Module for the Cloud9 IDE
 *
 * @copyright 2010, Ajax.org B.V.
 * @license GPLv3 <http://www.gnu.org/licenses/gpl.txt>
 */

define(function(require, exports, module) {

var ide = require("core/ide");
var ext = require("core/ext");
var Util = require("core/util");
var settings = require("core/settings");
var editors = require("ext/editors/editors");
var fs = require("ext/filesystem/filesystem");
var ideConsole = require("ext/console/console");
var menus = require("ext/menus/menus");
var skin = require("text!ext/searchinfiles/skin.xml");
var markup = require("text!ext/searchinfiles/searchinfiles.xml");
var commands = require("ext/commands/commands");
var tooltip = require("ext/tooltip/tooltip");
var libsearch = require("ext/searchreplace/libsearch");
var searchreplace = require("ext/searchreplace/searchreplace");

module.exports = ext.register("ext/searchinfiles/searchinfiles", apf.extend({
    name     : "Search in files",
    dev      : "Ajax.org",
    type     : ext.GENERAL,
    alone    : true,
    offline  : false,
    replaceAll : false,
    markup   : markup,
    skin     : {
        id   : "searchinfiles",
        data : skin,
        "media-path" : ide.staticPrefix + "/ext/searchinfiles/images/"
    },
    pageTitle: "Search Results",
    pageID   : "pgSFResults",

    nodes    : [],

    hook : function(){
        var _self = this;

        commands.addCommand({
            name: "searchinfiles",
            hint: "search for a string through all files in the current workspace",
            bindKey: {mac: "Shift-Command-F", win: "Ctrl-Shift-F"},
            exec: function () {
                _self.toggleDialog(0);
            }
        });

        this.nodes.push(
            menus.addItemByPath("Find/~", new apf.divider(), 10000),
            menus.addItemByPath("Find/Find in Files...", new apf.item({
                command : "searchinfiles"
            }), 20000)
        );
    },

    init : function(amlNode){
        var _self = this;
        
        ide.addEventListener("settings.load", function(e){
            e.ext.setDefaults("editors/code/filesearch", [
                ["regex", "false"],
                ["matchcase", "false"],
                ["wholeword", "false"]
            ]);
        });
        
        commands.addCommand({
            name: "hidesearchinfiles",
            bindKey: {mac: "ESC", win: "ESC"},
            isAvailable : function(editor){
                return winSearchInFiles.visible;
            },
            exec: function(env, args, request) {
                _self.toggleDialog(-1);
            }
        });
        
        ide.addEventListener("init.ext/console/console", function(e){
            mainRow.insertBefore(winSearchInFiles, e.ext.splitter);
        });
        if (winSearchInFiles.parentNode != mainRow) {
            mainRow.insertBefore(winSearchInFiles, 
                self.winDbgConsole && winDbgConsole.previousSibling || null);
        }

        winSearchInFiles.addEventListener("prop.visible", function(e) {
            if (e.value) {
                if (self.trFiles)
                    trFiles.addEventListener("afterselect", _self.setSearchSelection);
                _self.setSearchSelection();
            }
            else {
                var editor = editors.currentEditor;
                if (editor)
                    editor.focus();
        
                if (self.trFiles)
                    trFiles.removeEventListener("afterselect", 
                        this.setSearchSelection);
            }
        });
        ide.addEventListener("init.ext/tree/tree", function(){
            trFiles.addEventListener("afterselect", _self.setSearchSelection);
        });

        txtSFFind.addEventListener("keydown", function(e) {
            if (e.keyCode == 13 && !e.ctrlKey && !e.altKey && !e.metaKey) {
                _self.execFind();
                return false;
            }
            
            if (_self.findKeyboardHandler(e, "searchfiles", this, chkSFRegEx) === false)
                return false;
                
            if (chkSFRegEx.checked
              && _self.evaluateRegExp(txtSFFind, tooltipSearchInFiles, 
              winSearchInFiles, e.htmlEvent) === false) {
                return;
            }
        });
        txtSFFind.addEventListener("keyup", function(e) {
            if (e.keyCode != 8 && (e.ctrlKey || e.shiftKey || e.metaKey 
              || e.altKey || !apf.isCharacter(e.keyCode)))
                return;
            
            if (chkSFRegEx.checked) {
                _self.evaluateRegExp(
                    txtSFFind, tooltipSearchInFiles, winSearchInFiles);
            }
        });
        
        txtSFReplace.addEventListener("keydown", function(e) {
            if (e.keyCode == 13 && !e.ctrlKey && !e.altKey && !e.metaKey) {
                _self.replace();
                return false;
            }
            
            if (_self.findKeyboardHandler(e, "replacefiles", this, chkSFRegEx) === false)
                return false;
        });
        
        txtSFPatterns.addEventListener("keydown", function(e){
            if (e.keyCode == 13)
                return false;
            
            if (_self.findKeyboardHandler(e, "searchwhere", this) === false)
                return false;
        });
        
        var tt = document.body.appendChild(tooltipSearchInFiles.$ext);
        
        chkSFRegEx.addEventListener("prop.value", function(e){
            if (apf.isTrue(e.value)) {
                if (txtSFFind.getValue())
                    _self.updateInputRegExp(txtSFFind);
            }
            else
                _self.removeInputRegExp(txtSFFind);
        });
        
        var cbs = winSearchInFiles.getElementsByTagNameNS(apf.ns.aml, "checkbox");
        cbs.forEach(function(cb){
            tooltip.add(cb.$ext, {
                message : cb.label,
                width : "auto",
                timeout : 0,
                tooltip : tt,
                animate : false,
                getPosition : function(){
                    var pos = apf.getAbsolutePosition(winSearchInFiles.$ext);
                    var left = pos[0] + cb.getLeft();
                    var top = pos[1];
                    return [left, top - 16];
                }
            });
        });
    },

    setSearchSelection: function(e){
        var selectedNode;
        
        if (self.trFiles) {
            // If originating from an event
            if (e && e.selected)
                selectedNode = e.selected;
            else
                selectedNode = this.getSelectedTreeNode();
    
            var filepath = selectedNode.getAttribute("path").split("/");
    
            var name = "";
            // get selected node in tree and set it as selection
            if (selectedNode.getAttribute("type") == "folder") {
                name = filepath[filepath.length - 1];
            }
            else if (selectedNode.getAttribute("type") == "file") {
                name = filepath[filepath.length - 2];
            }
    
            if (name.length > 25) {
                name = name.substr(0, 22) + "...";
            }
        }
        else {
            var path = settings.model.queryValue("auto/tree_selection/@path");
            if (!path)
                return;
            
            var p;
            if ((name = (p = path.split("/")).pop()).indexOf(".") > -1)
                name = p.pop();
        }

        rbSFSelection.setAttribute("label", "Selection ( " + name + " )");
    },

    getSelectedTreeNode: function() {
        var node = self["trFiles"] ? trFiles.selected : fs.model.queryNode("folder[1]");
        if (!node)
            node = trFiles.xmlRoot.selectSingleNode("folder[1]");
        while (node.tagName != "folder")
            node = node.parentNode;
        return node;
    },
    
    toggleDialog: function(force, isReplace, noselect, callback) {
        var _self = this;
        
        ext.initExtension(this);

        tooltipSearchInFiles.$ext.style.display = "none";

        var animate = apf.isTrue(settings.model.queryValue("general/@animateui"));
        if (!force && !winSearchInFiles.visible || force > 0) {
            if (winSearchInFiles.visible) {
                txtSFFind.focus();
                txtSFFind.select();
                return;
            }
            
            if (searchreplace.inited && winSearchReplace.visible) {
                searchreplace.toggleDialog(-1, null, null, function(){
                    _self.toggleDialog(force, isReplace, noselect);
                });
                return;
            }
            
            winSearchInFiles.$ext.style.overflow = "hidden";
            winSearchInFiles.$ext.style.height 
                = winSearchInFiles.$ext.offsetHeight + "px";
            
            this.position = -1;

            var editor = editors.currentEditor;
            if (editor) {
                var sel   = editor.getSelection();
                var doc   = editor.getDocument();
                var range = sel.getRange();
                var value = doc.getTextRange(range);
    
                if (value) {
                    txtSFFind.setValue(value);
                    
                    delete txtSFFind.$undo;
                    delete txtSFFind.$redo;
                    
                    if (chkRegEx.checked)
                        this.updateInputRegExp(txtSFFind);
                }
            }

            winSearchInFiles.show();
            txtSFFind.focus();
            txtSFFind.select();
            
            winSearchInFiles.$ext.scrollTop = 0;
            document.body.scrollTop = 0;
            
            //Animate
            if (animate) {
                Firmin.animate(winSearchInFiles.$ext, {
                    height: "102px",
                    timingFunction: "cubic-bezier(.10, .10, .25, .90)"
                }, 0.2, function() {
                    winSearchInFiles.$ext.style[apf.CSSPREFIX + "TransitionDuration"] = "";
                    winSearchInFiles.$ext.style.height = "";
                    
                    setTimeout(function(){
                        apf.layout.forceResize();
                    }, 50);
                });
            }
            else {
                winSearchInFiles.$ext.style.height = "";
                apf.layout.forceResize();
            }
        }
        else if (winSearchInFiles.visible) {
            if (txtSFFind.getValue())
                _self.saveHistory(txtSFFind.getValue());
            
            
            //Animate
            if (animate) {
                winSearchInFiles.visible = false;
                
                winSearchInFiles.$ext.style.height 
                    = winSearchInFiles.$ext.offsetHeight + "px";

                Firmin.animate(winSearchInFiles.$ext, {
                    height: "0px",
                    timingFunction: "ease-in-out"
                }, 0.2, function(){
                    winSearchInFiles.visible = true;
                    winSearchInFiles.hide();
                    
                    winSearchInFiles.$ext.style[apf.CSSPREFIX + "TransitionDuration"] = "";
    
                    if (!noselect && editors.currentEditor)
                        editors.currentEditor.ceEditor.focus();
                    
                    setTimeout(function(){
                        callback 
                            ? callback()
                            : apf.layout.forceResize();
                    }, 50);
                });
            }
            else {
                winSearchInFiles.hide();
                callback 
                    ? callback()
                    : apf.layout.forceResize();
            }
        }

        return false;
    },

    searchinfiles: function() {
        this.toggleDialog(1);
    },

    getOptions: function() {
        var _self = this;

        return {
            query: txtSFFind.value,
            needle: txtSFFind.value,
            pattern: txtSFPatterns.value,
            casesensitive: chkSFMatchCase.checked ? "1" : "0",
            regexp: chkSFRegEx.checked ? "1" : "0",
            replaceAll: _self.replaceAll ? "true" : "false",
            replacement: txtSFReplace.value
        };
    },
    
    replace : function(){
        this.replaceAll = true;
        this.execFind();
        this.replaceAll = false;
    },

    execFind: function() {
        var _self = this;

        // show the console
        ideConsole.show();
        
        if (!this.$panel) {
            this.$panel = tabConsole.add(this.pageTitle, this.pageID);
            this.$panel.setAttribute("closebtn", true);
            this.$panel.appendChild(trSFHbox);
            
            tabConsole.set(_self.pageID);
            
            trSFHbox.show();
            trSFResult.setProperty("visible", true);
            this.$model = trSFResult.getModel();
            
            // make sure the tab is shown when results come in
            this.$model.addEventListener("afterload", function() {
                tabConsole.set(_self.pageID);
                trSFResult.addEventListener("afterselect", function(e) {
                    var node = trSFResult.selected,
                        line = 0, text = "", path;

                    if (node.tagName == "d:maxreached" || node.tagName == "d:querydetail")
                        return;

                    if (node.tagName == "d:excerpt") { // clicking on a line excerpt
                        path = node.parentNode.getAttribute("path");
                        line = node.getAttribute("line");
                        text = node.parentNode.getAttribute("query");
                    }
                    else { // clicking on filename
                        path = node.getAttribute("path");
                        line = apf.queryValue(node, "node()/@line");
                        text = apf.queryValue(node, "node()/@query");
                    }

                    editors.showFile(ide.davPrefix + "/" + path, line, 0, text);
                });
            });

            this.$panel.addEventListener("afterclose", function(){
                this.removeNode();
                return false;
            });
        }
        else {
            tabConsole.appendChild(this.$panel);
            tabConsole.set(this.pageID);
        }
        
        //Determine the scope
        var path;
        if (grpSFScope.value == "projects") {
            path = ide.davPrefix;
        }
        else if (!self.trFiles) {
            path = settings.model.queryValue("auto/tree_selection/@path");
            if (!path)
                return;
            
            var p;
            if ((name = (p = path.split("/")).pop()).indexOf(".") > -1)
                name = p.pop();
        }
        if (!path) {
            var node = this.getSelectedTreeNode();
            path = node.getAttribute("path");
        }

        var options = this.getOptions();
        var query = txtSFFind.value;
        options.query = query.replace(/\n/g, "\\n");

        // even if there's text in the "replace" field, don't send it when not replacing
        if (!this.replaceAll)
            options.replacement = ""; 

        this.$model.clear();
        this.$panel.setAttribute("caption", _self.pageTitle);
        
        trSFResult.setAttribute("empty-message", 
            "Searching for '" + query + "'...");

        davProject.report(path, "codesearch", options, function(data, state, extra){
            _self.replaceAll = false; // reset

            var matches = data.getElementsByTagNameNS("DAV:", "excerpt").length;
            var queryDetails = data.getElementsByTagNameNS("DAV:", "querydetail");
            
            if (queryDetails.length === 1) {
                queryDetails[0].setAttribute("count", ""+matches);
                queryDetails[0].setAttribute("filecount", 
                    "" + data.getElementsByTagNameNS("DAV:", "response").length);
            }
            
            if (state !== apf.SUCCESS || !matches) {
                var optionsDesc = [];
                if (Util.isTrue(options.casesensitive))
                    optionsDesc.push("case sensitive");
                if (Util.isTrue(options.regexp))
                    optionsDesc.push("regexp");

                optionsDesc = optionsDesc.length > 0
                    ? "(" + optionsDesc.join(", ") + ")"
                    : "";
                
                trSFResult.setAttribute("empty-message", 
                    "No matches for '" + query + "' " + optionsDesc);
                return;
            }
            else
                _self.$panel.setAttribute("caption", 
                    _self.pageTitle + " (" + matches + ")");

            _self.$model.load(data);
        });
        
        this.saveHistory(options.query, "searchfiles");
        this.position = 0;

        ide.dispatchEvent("track_action", {type: "searchinfiles"});
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
        menus.remove("Find/~", 10000);
        menus.remove("Find in Files...");
        
        commands.removeCommandByName("searchinfiles");
        
        this.nodes.each(function(item){
            item.destroy(true, true);
        });
        this.nodes = [];
    }
}, libsearch));

});
