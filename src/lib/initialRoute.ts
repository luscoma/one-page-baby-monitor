import { consumeHashRoute } from './invite';

/**
 * Read once, at module load, because it clears the URL fragment as a side effect. Doing this
 * in a component initialiser would run twice under StrictMode and lose the route on the second
 * pass, when the fragment is already gone.
 */
export const initialRoute = consumeHashRoute();
