#!/usr/bin/env node
'use strict';

// @qiuqiukof/hesi CLI launcher.
// Starts the Hesi server (server.js) as a child process so that CLI flags and
// signals (Ctrl+C / SIGTERM) propagate correctly. The server binds loopback by
// default (HOST='loopback'); set HOST / PORT env to change, e.g.:
//   HOST=0.0.0.0 PORT=4264 hesi
// (Exposing 0.0.0.0 makes Hesi reachable on the network — put it behind a
//  reverse proxy with auth, since Hesi has no built-in authentication.)

const path = require('path');
const { spawn } = require('child_process');

const serverPath = path.join(__dirname, '..', 'server.js');

const child = spawn(process.execPath, [serverPath, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code) => {
  process.exit(code === null ? 0 : code);
});
