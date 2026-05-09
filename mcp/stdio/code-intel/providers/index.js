const registry = new Map();

export function registerProvider(name, factory) {
  registry.set(name, factory);
}

export function getProvider(name) {
  const factory = registry.get(name);
  return factory ? factory() : null;
}

export function listProviders() {
  return [...registry.keys()];
}

export function clearProviders() {
  registry.clear();
}
