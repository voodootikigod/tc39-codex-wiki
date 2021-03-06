var Project = require('codex/lib/codex/project');
var path = require('path');
var fs = require('fs');
var ncp = require('ncp').ncp;
var rimraf = require('rimraf');
var async = require('async');
var git = require('./git');

var rootDir = path.join(__dirname, "..");

var outDir = path.join(rootDir, "out");
var dataDir = path.join(rootDir, "data");
var templateDir = path.join(rootDir, "template");
var ghpagesDir = path.join(rootDir, "gh-pages");

function ls(dir, cb) {
    fs.readdir(dir, function(err, files) {
        if (err) return cb(err);
        cb(null, files.filter(function(file) {
            return file[0] !== '.';
        }));
    });
}

function urlFormatter(baseURL) {
    var length = baseURL.length;
    if (baseURL[length - 1] === '/')
        baseURL = baseURL.substring(0, length - 1);

    return function(url) {
        return url[0] === '/'
            ? baseURL + url
            : url;
    }
}

function build(baseURL, sourceURL, cb) {
    var project = new Project({
        inDir: rootDir,
        outDir: outDir,
        dataDir: dataDir,
        templateDir: templateDir,
        urlFormatter: urlFormatter(baseURL),
        locals: {
            "title": "ECMAScript Wiki",
            "baseURL": baseURL,
            "sourceURL": sourceURL
        }
    });

    // monkey-patch highlight.js with ES6 keywords
    var keywords = project.LANGUAGES.javascript.defaultMode.keywords;
    keywords.keyword.import = 1;
    keywords.keyword.export = 1;
    keywords.keyword.let = 1;
    keywords.keyword.module = 1;
    keywords.keyword.from = 1;

    project.on("error", cb);
    project.build(cb);
}

function push(message, cb) {
    var ghpages = git(ghpagesDir);

    async.waterfall([
        // ls <ghpages>/*
        function(cb) {
            ls(ghpagesDir, cb);
        },

        // rm -rf <ghpages>/*
        function(files, cb) {
            console.log("gh-pages files: " + files);
            async.forEachSeries(files.map(function(file) {
                return path.join(ghpagesDir, file);
            }), rimraf, cb);
        },

        // ls out/*
        function(cb) {
            ls(outDir, cb);
        },

        // cp -R out/* <ghpages>/
        function(files, cb) {
            console.log("out files: " + files);
            ncp.limit = 16;
            async.forEachSeries(files, function(file, cb) {
                ncp(path.join(outDir, file), path.join(ghpagesDir, file), cb);
            }, cb);
        },

        // git status
        function(cb) {
            ghpages.status(cb);
        },

        // filter added/removed files
        function(status, cb) {
            var add = [], rm = [];
            var files = status.files;
            for (var filename in files) {
                if (!{}.hasOwnProperty.call(files, filename))
                    continue;
                var file = files[filename];
                if (!file.tracked || file.type === 'M')
                    add.push(filename);
                else
                    rm.push(filename);
            }
            console.log("added files: " + add);
            console.log("removed files: " + rm);

            if (add.length === 0 && rm.length === 0) {
                console.log("no changes");
                return cb();
            }

            async.series([
                // git rm -rf <removed files>
                function(cb) {
                    ghpages.rimraf(rm, cb);
                },
                // git add <added files>
                function(cb) {
                    ghpages.add(add, cb);
                },
                // git commit
                function(cb) {
                    console.log("committing with message \"" + message + "\"");
                    ghpages.commit(message, cb);
                },
                // git push origin gh-pages
                function(cb) {
                    console.log("pushing branch gh-pages");
                    ghpages.push("origin", "gh-pages", cb);
                }
            ], cb);
        }
    ], cb);
}

function cloneGHPages(repo, cb) {
    var ghpages = git(ghpagesDir);
    path.exists(path.join(ghpagesDir, ".git"), function(exists) {
        if (exists) return cb();
        ghpages.clone(repo, function(err) {
            if (err) return cb(err);
            ghpages.checkout("gh-pages", cb);
        });
    });
}

module.exports.build = build;
module.exports.push = push;
module.exports.cloneGHPages = cloneGHPages;
