import * as path from 'path';
import { Settings } from '@elements/settings';

/**
 * Returns a settings object for the app. If there exists an app/settings folder
 * that is used, otherwise an empty settings instance is used.
 */
export function getAppSettings(): Settings {
  try {
    let requirePath = path.join(process.cwd(), 'app', 'settings');
    let exports = require(requirePath);
    let settings = exports.default;
    return new Settings(settings);
  } catch (err) {
    if (/Cannot find module/.test(err.toString())) {
      return new Settings();
    } else {
      throw err;
    }
  }
}
