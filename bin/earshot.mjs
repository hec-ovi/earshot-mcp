#!/usr/bin/env node
import { homedir } from 'node:os';
import { join } from 'node:path';
import { serve } from '../server/mcp.mjs';

serve({
  dir: process.env.EARSHOT_DIR || join(homedir(), '.earshot'),
  channel: process.argv.includes('--channel'),
});
