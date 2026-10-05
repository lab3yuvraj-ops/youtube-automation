import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { setup, root, envFile } from './setupConfig.js';

try {
  await fs.copyFile(path.join(root, 'scripting/.env.example'), envFile, constants.COPYFILE_EXCL);
} catch (error: any) {
  if (error.code !== 'EEXIST') throw error;
}
try {
  await setup();
  console.log('Setup complete. Your settings and channel assets are ready.');
} catch (error: any) {
  console.log(`
Welcome to YouTube Automation!
Please provide your channel logo image (PNG or JPG) and your intro video
(MP4, at least 5 seconds long, with audio).

All other settings are read from your local .env file:
${envFile}
Your existing settings have been preserved.
`);
  console.error(`Still needed: ${error.message}`);
  process.exitCode = 1;
}
