// POSITIVE CONTROL for the attribution-eligibility predicate. This fixture exists to prove the
// predicate can say AVAILABLE. A guard that always answers UNAVAILABLE would otherwise pass every
// arm without anyone noticing, which is the failure the C++ arm already demonstrated once.
import { Widget as AlphaWidget, alphaHelper } from './alpha.js';
import { Widget as BetaWidget, betaHelper } from './beta.js';

export function alphaCaller() {
  const w = new AlphaWidget();
  alphaHelper();
  return w.render();
}

export function betaCaller() {
  const w = new BetaWidget();
  betaHelper();
  return w.render();
}
