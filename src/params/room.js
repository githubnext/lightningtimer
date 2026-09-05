/** Room names are case-sensitive; reserve /api for server endpoints.
 * @param {string} param
 */
export function match(param) {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(param) && param !== 'api';
}
