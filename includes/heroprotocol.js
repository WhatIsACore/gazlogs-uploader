'use strict';

const fs = require('fs');
const path = require('path');
const MPQArchive = exports.MPQArchive = require('mpyqjs/mpyq').MPQArchive;
const protocol29406 = exports.protocol =  require('heroprotocol/lib/protocol29406');
var logger = require('winston');

const version = exports.version = require('heroprotocol/package.json').version;

// parsable parts
const HEADER            = exports.HEADER            = 'header';
const DETAILS           = exports.DETAILS           = 'replay.details';
const INITDATA          = exports.INITDATA          = 'replay.initdata';
const GAME_EVENTS       = exports.GAME_EVENTS       = 'replay.game.events';
const MESSAGE_EVENTS    = exports.MESSAGE_EVENTS    = 'replay.message.events';
const TRACKER_EVENTS    = exports.TRACKER_EVENTS    = 'replay.tracker.events';
const ATTRIBUTES_EVENTS = exports.ATTRIBUTES_EVENTS = 'replay.attributes.events';
const RAW_DATA          = exports.RAW_DATA          = 'replay.server.battlelobby';

const decoderMap = {
  [HEADER]:             'decodeReplayHeader',
  [DETAILS]:            'decodeReplayDetails',
  [INITDATA]:           'decodeReplayInitdata',
  [GAME_EVENTS]:        'decodeReplayGameEvents',
  [MESSAGE_EVENTS]:     'decodeReplayMessageEvents',
  [TRACKER_EVENTS]:     'decodeReplayTrackerEvents',
  [ATTRIBUTES_EVENTS]:  'decodeReplayAttributesEvents'
};

const parseStrings = function parseStrings(data) {
  if (!data) return data;
  else if (data instanceof Buffer) return data.toString();
  else if (Array.isArray(data)) return data.map(item => parseStrings(item));
  else if (typeof data === 'object') {
    for (let key in data) {
      data[key] = parseStrings(data[key]);
    }
  }
  return data;
};

let lastUsed;

exports.open = function (file, noCache) {
  let archive, header;

  if (!lastUsed || !(lastUsed instanceof MPQArchive) || file !== lastUsed.filename || noCache) {

    if (typeof file === 'string') {
      try {
        if (!path.isAbsolute(file)) {
          file = path.join(process.cwd(), file);
        }
        archive = new MPQArchive(file);
        archive.filename = file;
      } catch (err) {
        archive = err;
      }
    } else if (file instanceof MPQArchive) {
      // TODO - need to check what happens when instanciating an MPQArchive with
      // invalid path and setup an error accordingly
      archive = file;
    } else {
      archive = new Error('Unsupported parameter: ${file}');
    }

    if (archive instanceof Error) return archive;
    lastUsed = archive;

    // parse header
    archive.data = {};
    header = archive.data[HEADER] = parseStrings(protocol29406.decodeReplayHeader(archive.header.userDataHeader.content));
    // The header's baseBuild determines which protocol to use
    archive.baseBuild = header.m_version.m_baseBuild;

    try {
      archive.protocol = require(`heroprotocol/lib/protocol${archive.baseBuild}`);
    } catch (err) {
      archive.error = err;
    }

    if (archive.protocol) {

      // set header to proper protocol
      archive.data[HEADER] = parseStrings(archive.protocol.decodeReplayHeader(archive.header.userDataHeader.content));

      archive.get = function (file) {
        return exports.get(file, archive);
      };

    } else {
      archive.error = 'protocol ' + archive.baseBuild + ' not found';
    }

  } else {
    // load archive from cache
    archive = lastUsed;
  }

  return archive;
};

// returns the content of a file in a replay archive
exports.get = function (archiveFile, archive, keys, keys2) {
  let data;
  archive = exports.open(archive);

  if (archive instanceof Error || archive.error) {
    logger.log('info', 'Heroprotocol: ' + archive.error);
    return data;
  }

  if (archive.data[archiveFile] && !keys) {
    data = archive.data[archiveFile];
  } else {
    if (archive.protocol) {

      if ([DETAILS, INITDATA, ATTRIBUTES_EVENTS].indexOf(archiveFile) > -1) {
        data = archive.data[archiveFile] =
          parseStrings(archive.protocol[decoderMap[archiveFile]](
            archive.readFile(archiveFile)
          ));
      } else if ([GAME_EVENTS, MESSAGE_EVENTS, TRACKER_EVENTS].indexOf(archiveFile) > -1) {

        if (keys) {
          // protocol function to call is a generator
          data = [];
          for (var i = 0, j = keys.length; i < j; i++) data.push([]);
          for (let event of archive.protocol[decoderMap[archiveFile]](archive.readFile(archiveFile))) {

            // check validity with whitelisted keys
            for (var i = 0, j = keys.length; i < j; i++){
              for (var key in keys[i]) {
                if (parseStrings(event)[key] === keys[i][key]){
                    data[i].push(parseStrings(event));
                }
              }
            }

          }

        } else {
          data = archive.data[archiveFile] = [];
          for (let event of archive.protocol[decoderMap[archiveFile]](archive.readFile(archiveFile))) {
            data.push(parseStrings(event));
          }
        }

      } else if (archiveFile === RAW_DATA) {
        data = archive.data[archiveFile] = parseStrings(archive.readFile(archiveFile));
      }

    }
  }

  return data;
};

/**
 * parses a basic MPQ header
 * @function
 * @param {buffer} buffer - Header content from MPQ archive
 * @returns {object} Header information from file
 */
exports.parseHeader = function (buffer) {
  return parseStrings(protocol29406.decodeReplayHeader(buffer));
};

/**
 * parses a buffer based on a given build
 * @function
 * @param {string} filename - Name of the file to assist in parsing
 * @param {buffer} buffer - Binary file contents from MPQ archive
 * @param {string} build - Build in which to parse the contents
 * @returns {object} File contents
 */
exports.parseFile = function (filename, buffer, build) {
  let data, protocol;

  try {
    protocol = require(`heroprotocol/lib/protocol${build}`);
  } catch (err) {
    return undefined;
  }

  if ([DETAILS, INITDATA, ATTRIBUTES_EVENTS].indexOf(filename) > -1) {
    data = parseStrings(protocol[decoderMap[filename]](buffer));
  } else if ([GAME_EVENTS, MESSAGE_EVENTS, TRACKER_EVENTS].indexOf(filename) > -1) {
    data = [];
    for (let event of protocol[decoderMap[filename]](buffer)) {
      data.push(parseStrings(event));
    }
  }

  return data;
};
