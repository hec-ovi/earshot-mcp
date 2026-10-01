#!/usr/bin/env node
import { homedir } from 'node:os';
import { join } from 'node:path';
import { check, serve } from '../server/mcp.mjs';

const dir = process.env.EARSHOT_DIR || join(homedir(), '.earshot');
if (process.argv.includes('--check')) process.exit(check(dir));
serve({ dir, channel: process.argv.includes('--channel') });
