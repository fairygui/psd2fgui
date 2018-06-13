/*!
 * psd2fgui
 * @license [MIT]
 * @copyright http://www.fairygui.com/
 */

"use strict";

const PSD = require('psd');
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const archiver = require('archiver');
const xmlbuilder = require('xmlbuilder');

//The group name prefix identified as a component.
const componentPrefix = 'Com';

//The group name prefix identified as a common button.
const commonButtonPrefix = 'Button';

//The group name prefix identified as a checkbox button.
const checkButtonPrefix = 'CheckButton';

//The group name prefix identified as a radio button.
const radioButtonPrefix = 'RadioButton';

//The layer name suffix of each status of the button.
const buttonStatusSuffix = ['@up', '@down', '@over', '@selectedOver'];

exports.constants = {
    NO_PACK: 1,
    IGNORE_FONT: 2
};

var targetPackage;

/**
 * Convert a PSD file to a fairygui package.
 * @param {string} psdFile path of the psd file.
 * @param {string} outputFile optional. output file path.
 * @param {integer} option psd2fgui.constants.
 * @param {string} buildId optinal. You can use same build id to keep resource ids unchanged during multiple converting for a psd file.
 * @return {string} output file path.
 */
exports.convert = function (psdFile, outputFile, option, buildId) {
    return new Promise(function (resolve, reject) {
        if (!option)
            option = 0;
        if (!buildId)
            buildId = genBuildId();

        var pathInfo = path.parse(psdFile);
        var outputDirectory;

        if (option & exports.constants.NO_PACK) {
            outputDirectory = outputFile;
            if (!outputDirectory)
                outputDirectory = path.join(pathInfo.dir, pathInfo.name + '-fairypackage');
        }
        else {
            outputDirectory = path.join(pathInfo.dir, pathInfo.name + '~temp');
            fs.emptyDirSync(outputDirectory);

            if (!outputFile)
                outputFile = path.join(pathInfo.dir, pathInfo.name + '.fairypackage');
        }

        var psd = PSD.fromFile(psdFile);
        psd.parse();

        targetPackage = new UIPackage(outputDirectory, buildId);
        targetPackage.exportOption = option;

        createComponent(psd.tree(), pathInfo.name);

        var pkgDesc = xmlbuilder.create('packageDescription');
        pkgDesc.att('id', targetPackage.id);
        var resourcesNode = pkgDesc.ele('resources');
        var savePromises = [];

        targetPackage.resources.forEach(function (item) {
            var resNode = resourcesNode.ele(item.type);
            resNode.att('id', item.id).att('name', item.name).att('path', '/');
            if (item.type == 'image') {
                if (item.scale9Grid) {
                    resNode.att('scale', item.scale);
                    resNode.att('scale9Grid', item.scale9Grid);
                }
            }

            if (item.type == 'image')
                savePromises.push(item.data.saveAsPng(path.join(targetPackage.basePath, item.name)));
            else
                savePromises.push(fs.writeFile(path.join(targetPackage.basePath, item.name), item.data));
        });

        savePromises.push(fs.writeFile(path.join(targetPackage.basePath, 'package.xml'),
            pkgDesc.end({ pretty: true })));

        var pa = Promise.all(savePromises);
        if (option & exports.constants.NO_PACK) {
            pa.then(function () {
                console.log(psdFile + '->' + outputDirectory);
                resolve(buildId);
            }).catch(function (reason) {
                reject(reason);
            });
        }
        else {
            pa.then(function () {
                return fs.readdir(outputDirectory);
            }).then(function (files) {
                var output = fs.createWriteStream(outputFile);
                output.on('close', function () {
                    fs.emptyDirSync(outputDirectory);
                    fs.rmdirSync(outputDirectory);

                    console.log(psdFile + '->' + outputFile);
                    resolve(buildId);
                });

                var zipArchiver = archiver('zip');
                zipArchiver.pipe(output);
                files.forEach(function (ff) {
                    zipArchiver.file(path.join(outputDirectory, ff), { 'name': ff });
                });
                zipArchiver.finalize();
            }).catch(function (reason) {
                reject(reason);
            });
        }
    });
}

//=====================================================================================
function UIPackage(basePath, buildId) {
    this.id = buildId.substr(0, 8);
    this.itemIdBase = buildId.substr(8);
    this.nextItemIndex = 0;
    this.getNextItemId = function () {
        return this.itemIdBase + (this.nextItemIndex++).toString(36);
    };

    this.basePath = basePath;
    fs.ensureDirSync(basePath);

    this.resources = [];
    this.sameDataTestHelper = {};
    this.sameNameTestHelper = {};
}

function createImage(aNode, scale9Grid) {
    var packageItem = createPackageItem('image', aNode.get('name') + '.png', aNode);
    if (scale9Grid) {
        packageItem.scale = '9grid';
        packageItem.scale9Grid = scale9Grid;
    }

    return packageItem;
}

function createComponent(aNode, name) {
    var component = xmlbuilder.create('component');
    component.att('size', aNode.get('width') + ',' + aNode.get('height'));
    var displayList = component.ele('displayList');

    var cnt = aNode.children().length;
    for (var i = cnt - 1; i >= 0; i--) {
        parseNode(aNode.children()[i], aNode, displayList);
    }

    return createPackageItem('component', (name ? name : aNode.get('name')) + '.xml', component.end({ pretty: true }));
}

function createButton(aNode, instProps) {
    var component = xmlbuilder.create('component');
    component.att('size', aNode.get('width') + ',' + aNode.get('height'));
    component.att('extention', 'Button');

    var images = [];
    var imagePages = [];
    var imageCnt = 0;
    aNode.descendants().forEach(function (childNode) {
        var nodeName = childNode.get('name');
        for (var i in buttonStatusSuffix) {
            if (nodeName.indexOf(buttonStatusSuffix[i]) != -1) {
                images[i] = childNode;
                imageCnt++;
            }
        };
    });
    for (var i in buttonStatusSuffix) {
        imagePages[i] = [];
        if (!images[i]) {
            if (i == 3 && images[1]) //if no 'selectedOver', use 'down'
                imagePages[1].push(i);
            else //or else, use 'up'
                imagePages[0].push(i);
        }
        else {
            imagePages[i].push(i);
        }
    }

    var onElementCallback = function (child, node) {
        var nodeName = node.get('name');
        var j = images.indexOf(node);
        if (j != -1) {
            var gear = child.ele('gearDisplay');
            gear.att('controller', 'button');
            gear.att('pages', imagePages[j].join(','));
        }

        if (nodeName.indexOf('@title') != -1) {
            if (child.attributes['text']) {
                instProps['@title'] = child.attributes['text'].value;
                child.removeAttribute('text');
            }
        }
        else if (nodeName.indexOf('@icon') != -1) {
            if (child.attributes['url']) {
                instProps['@icon'] = child.attributes['url'].value;
                child.removeAttribute('url');
            }
        }
    };

    var controller = component.ele('controller');
    controller.att('name', 'button');
    controller.att('pages', '0,up,1,down,2,over,3,selectedOver');

    var displayList = component.ele('displayList');
    var cnt = aNode.children().length;
    for (i = cnt - 1; i >= 0; i--) {
        parseNode(aNode.children()[i], aNode, displayList, onElementCallback);
    }

    var extension = component.ele('Button');
    if (aNode.get('name').indexOf(checkButtonPrefix) == 0) {
        extension.att('mode', 'Check');
        instProps['@checked'] = 'true';
    }
    else if (aNode.get('name').indexOf(radioButtonPrefix) == 0)
        extension.att('mode', 'Radio');

    if (imageCnt == 1) {
        extension.att('downEffect', 'scale');
        extension.att('downEffectValue', '1.1');
    }

    return createPackageItem('component', aNode.get('name') + '.xml', component.end({ pretty: true }));
}

function createPackageItem(type, fileName, data) {
    var dataForHash;
    if (type == 'image') //data should a psd layer
        dataForHash = Buffer.from(data.get('image').pixelData);
    else
        dataForHash = data;
    var hash = crypto.createHash('md5').update(dataForHash).digest('hex');
    var item = targetPackage.sameDataTestHelper[hash];
    if (!item) {
        item = {};
        item.type = type;
        item.id = targetPackage.getNextItemId();

        var i = fileName.lastIndexOf('.');
        var basename = fileName.substr(0, i);
        var ext = fileName.substr(i);
        basename = basename.replace(/[\@\'\"\\\/\b\f\n\r\t\$\%\*\:\?\<\>\|]/g, '_');
        while (true) {
            var j = targetPackage.sameNameTestHelper[basename];
            if (j == undefined) {
                targetPackage.sameNameTestHelper[basename] = 1;
                break;
            }
            else {
                targetPackage.sameNameTestHelper[basename] = j + 1;
                basename = basename + '_' + j;
            }
        }
        fileName = basename + ext;
        item.name = fileName;
        item.data = data;
        targetPackage.resources.push(item);
        targetPackage.sameDataTestHelper[hash] = item;
    }

    return item;
}

function parseNode(aNode, rootNode, displayList, onElementCallback) {
    var child;
    var packageItem;
    var instProps;
    var str;

    var nodeName = aNode.get('name');
    var specialUsage;
    if (nodeName.indexOf('@title') != -1)
        specialUsage = 'title';
    else if (nodeName.indexOf('@icon') != -1)
        specialUsage = 'icon';

    if (aNode.isGroup()) {
        if (nodeName.indexOf(componentPrefix) == 0) {
            packageItem = createComponent(aNode);
            child = xmlbuilder.create('component');
            str = 'n' + (displayList.children.length + 1);
            child.att('id', str + '_' + targetPackage.itemIdBase);
            child.att('name', specialUsage ? specialUsage : str);
            child.att('src', packageItem.id);
            child.att('fileName', packageItem.name);
            child.att('xy', (aNode.left - rootNode.left) + ',' + (aNode.top - rootNode.top));
        }
        else if (nodeName.indexOf(commonButtonPrefix) == 0 || nodeName.indexOf(checkButtonPrefix) == 0 || nodeName.indexOf(radioButtonPrefix) == 0) {
            instProps = {};
            packageItem = createButton(aNode, instProps);
            child = xmlbuilder.create('component');
            str = 'n' + (displayList.children.length + 1);
            child.att('id', str + '_' + targetPackage.itemIdBase);
            child.att('name', specialUsage ? specialUsage : str);
            child.att('src', packageItem.id);
            child.att('fileName', packageItem.name);
            child.att('xy', (aNode.left - rootNode.left) + ',' + (aNode.top - rootNode.top));
            child.ele({ Button: instProps });
        }
        else {
            var cnt = aNode.children().length;
            for (var i = cnt - 1; i >= 0; i--)
                parseNode(aNode.children()[i], rootNode, displayList, onElementCallback);
        }
    }
    else {
        var typeTool = aNode.get('typeTool');
        if (typeTool) {
            child = xmlbuilder.create('text');
            str = 'n' + (displayList.children.length + 1);
            child.att('id', str + '_' + targetPackage.itemIdBase);
            child.att('name', specialUsage ? specialUsage : str);
            child.att('text', typeTool.textValue);
            if (specialUsage == 'title') {
                child.att('xy', '0,' + (aNode.top - rootNode.top - 4));
                child.att('size', rootNode.width + ',' + (aNode.height + 8));
                child.att('align', 'center');
            }
            else {
                child.att('xy', (aNode.left - rootNode.left - 4) + ',' + (aNode.top - rootNode.top - 4));
                child.att('size', (aNode.width + 8) + ',' + (aNode.height + 8));
                str = typeTool.alignment()[0];
                if (str != 'left')
                    child.att('align', str);
            }
            child.att('vAlign', 'middle');
            child.att('autoSize', 'none');
            if (!(targetPackage.exportOption & exports.constants.IGNORE_FONT))
                child.att('font', typeTool.fonts()[0]);
            child.att('fontSize', typeTool.sizes()[0]);
            child.att('color', convertToHtmlColor(typeTool.colors()[0]));
        }
        else if (!aNode.isEmpty()) {
            packageItem = createImage(aNode);
            if (specialUsage == 'icon')
                child = xmlbuilder.create('loader');
            else
                child = xmlbuilder.create('image');
            str = 'n' + (displayList.children.length + 1);
            child.att('id', str + '_' + targetPackage.itemIdBase);
            child.att('name', specialUsage ? specialUsage : str);
            child.att('xy', (aNode.left - rootNode.left) + ',' + (aNode.top - rootNode.top));
            if (specialUsage == 'icon') {
                child.att('size', aNode.width + ',' + aNode.height);
                child.att('url', 'ui://' + targetPackage.id + packageItem.id);
            }
            else
                child.att('src', packageItem.id);
            child.att('fileName', packageItem.name);
        }
    }

    if (child) {
        var opacity = aNode.get('opacity');
        if (opacity < 255)
            child.att('alpha', (opacity / 255).toFixed(2));

        if (onElementCallback)
            onElementCallback(child, aNode);

        displayList.importDocument(child);
    }

    return child;
}

//=====================================================================================
function genBuildId() {
    var magicNumber = Math.floor(Math.random() * 36).toString(36).substr(0, 1);
    var s1 = '0000' + Math.floor(Math.random() * 1679616).toString(36);
    var s2 = '000' + Math.floor(Math.random() * 46656).toString(36);
    var count = 0;
    for (var i = 0; i < 4; i++) {
        var c = Math.floor(Math.random() * 26);
        count += Math.pow(26, i) * (c + 10);
    }
    count += Math.floor(Math.random() * 1000000) + Math.floor(Math.random() * 222640);

    return magicNumber + s1.substr(s1.length - 4) + s2.substr(s2.length - 3) + count.toString(36);
}

function convertToHtmlColor(rgbaArray, includingAlpha) {
    var result = '#';
    var str;
    if (includingAlpha) {
        str = rgbaArray[3].toString(16);
        if (str.length == 1)
            str = '0' + str;
        result += str;
    }

    for (var i = 0; i < 3; i++) {
        str = rgbaArray[i].toString(16);
        if (str.length == 1)
            str = '0' + str;
        result += str;
    }

    return result;
}