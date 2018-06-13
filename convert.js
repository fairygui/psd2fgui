#!/usr/bin/env node

var psd2fgui = require("./lib.js");

function run(argv) {
    if (argv.length == 0) {
        console.info('Usage: psd2fgui psdFile [outputFile] [--nopack] [--ignore-font] [#buildId]');
        process.exit(0);
    }

    var psdFile = argv[0];
    var outputFile;
    var option = 0;
    var buildId;
    for (var i = 1; i < argv.length; i++) {
        var arg = argv[i];
        if (arg.indexOf('--') == 0) {
            switch (arg.substr(2)) {
                case 'nopack':
                    option |= psd2fgui.constants.NO_PACK;
                    break;
                case 'ignore-font':
                    option |= psd2fgui.constants.IGNORE_FONT;
                    break;
                default:
                    console.error('unknown argument: ' + arg);
                    process.exit(1);
                    break;
            }
        }
        else if (arg.substr(0,1) == '#') {
            buildId = arg.substr(1);
        }
        else {
            if (!outputFile)
                outputFile = arg;
            else {
                console.error('unknown argument: ' + arg);
                process.exit(1);
            }
        }
    }

    psd2fgui.convert(psdFile, outputFile, option, buildId)
        .then(function (buildId) {
            console.log('buildId: ' + buildId);
        }).catch(console.err);
}

run(process.argv.slice(2));