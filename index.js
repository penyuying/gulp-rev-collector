'use strict';
var _            = require('underscore');
var gutil        = require('gulp-util');
var PluginError  = gutil.PluginError;
var through      = require('through2');
var path         = require('path');

var PLUGIN_NAME  = 'gulp-rev-collector';

var defaults = {
    revSuffix: '-[0-9a-f]{8,10}-?'
};

function _getManifestData(file, opts) {
    var data;
    var ext = path.extname(file.path);
    opts=opts||{};
    opts.type=opts.type||"name";
    if (ext === '.json') {
        var json = {};
        try {
            var content = file.contents.toString('utf8');
            if (content) {
                try{
                    json = JSON.parse(content);
                }catch (e) {
                    console.log("err:"+file.path);
                }
                
            }
        } catch (x) {
            console.log("err:"+file.path);
            //this.emit('error', new PluginError(PLUGIN_NAME,  x));
            return;
        }
        if (_.isObject(json)) {
            var isRev = 1;
            Object.keys(json).forEach(function (key) {
                if(opts.type=="part"){
                    if ( path.basename(json[key]).split('?')[0] !== path.basename(key) ) {
                        isRev = 0;
                    }
                }else{
                    if ( path.basename(json[key]).replace(new RegExp( opts.revSuffix ), '' ) !==  path.basename(key) ) {
                        isRev = 0;
                    }
                }
                
            });
            if (isRev) {
                data = json;
            }
        }
        
    }
    return data;
}

function escPathPattern(pattern) {
    return pattern.replace(/[\-\[\]\{\}\(\)\*\+\?\.\^\$\|\/\\]/g, "\\$&");
}

function closeDirBySep(dirname) {
    return dirname + (!dirname || new RegExp( escPathPattern('/') + '$' ).test(dirname) ? '' : '/');
}

//相对路径转成绝对路径
function absPath(dir) {
    var res = dir;

    if (!dir) {
        return res;
    }
    if (!path.isAbsolute(dir)) {//相对路径转绝对路径
        res = path.normalize(path.join(process.cwd(), dir)).replace(/\\/g, "/");
    } else {
        res = path.normalize(dir).replace(/\\/g, "/");
    }
    return res;
}
    
function revCollector(opts) {
    opts = _.defaults((opts || {}), defaults);
    var manifest  = {};
    var mutables = [];
    opts.file=absPath(opts.file)||"";
    opts.type=opts.type||"name";

    return through.obj(function (file, enc, cb) {
        if (!file.isNull()) {
            var mData = _getManifestData.call(this, file, opts);
            if (mData) {
                _.extend( manifest, mData );
            } else {
                var rr=false;
                if(file.path){
                    var fileDir=path.normalize(opts.file);
                    rr=new RegExp("^"+escPathPattern(fileDir), 'g' )
                    rr=rr.test(file.path)
                }
                if(!rr){
                    mutables.push(file);
                }
            }
        }else{
            mutables.push(file);
        }
        cb();
    }, function (cb) {
        var changes = [];
        var dirReplacements = [];
        if ( _.isObject(opts.dirReplacements) ) {
            Object.keys(opts.dirReplacements).forEach(function (srcDirname) {
                dirReplacements.push({
                    dirRX:  escPathPattern( closeDirBySep(srcDirname) ),
                    dirRpl: opts.dirReplacements[srcDirname]
                });
            });
        }

        for (var key in manifest) {
            var patterns = [ escPathPattern(key) ];
            if (opts.replaceReved) {
                patterns.push( escPathPattern( (path.dirname(key) === '.' ? '' : closeDirBySep(path.dirname(key)) ) + path.basename(key, path.extname(key)) ) 
                            + opts.revSuffix 
                            + escPathPattern( path.extname(key) )
                        );
            }

            if ( dirReplacements.length ) {
                dirReplacements.forEach(function (dirRule) {
                    patterns.forEach(function (pattern) {
                        changes.push({
                            regexp: new RegExp(  dirRule.dirRX + pattern, 'g' ),
                            patternLength: (dirRule.dirRX + pattern).length,
                            replacement: _.isFunction(dirRule.dirRpl) 
                                            ? dirRule.dirRpl(manifest[key]) 
                                            : closeDirBySep(dirRule.dirRpl) + manifest[key]
                        });
                    });
                });
            } else {
                patterns.forEach(function (pattern) {
                    if(opts.type=="part"){
                        var _fix="(\\/|^|\\\"|\\'|\\=|\\(|\\n|\\r\s)";
                        pattern=_fix+pattern+"+[\?]*";//如果是参数后缀形式
                    }
                    
                    changes.push({
                        regexp: new RegExp( pattern, 'g' ),
                        patternLength: pattern.length,
                        replacement: manifest[key]
                    });
                });
            }
        }

        // Replace longer patterns first
        // e.g. match `script.js.map` before `script.js`
        changes.sort(
            function(a, b) {
                return b.patternLength - a.patternLength;
            }
        );
        mutables.forEach(function (file){
            if (!file.isNull()) {
                var src = file.contents.toString('utf8');
                changes.forEach(function (r) {
                    src = src.replace(r.regexp, function($1,$2){
                        var res=r.replacement;
                        if($1 && $1.substr(-1)=="?"){
                            if(opts.type=="part"){
                                res=res+"&";
                            }else{
                                res=res+"?";
                            }
                        }
                        return ($2||"")+res;
                    });
                });
                file.contents = new Buffer(src);
            }
            this.push(file);
        }, this);
        
        cb();
    });
}

module.exports = revCollector;
