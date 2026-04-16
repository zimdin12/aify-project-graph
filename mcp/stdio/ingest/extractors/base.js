export function createFrameworkPlugin(plugin) {
  if (!plugin?.name || typeof plugin.detect !== 'function' || typeof plugin.enrich !== 'function') {
    throw new Error('framework plugin requires name, detect(), and enrich()');
  }

  return plugin;
}

export async function applyFrameworkPlugins({ repoRoot, result, plugins = [] }) {
  let current = {
    nodes: [...(result?.nodes ?? [])],
    edges: [...(result?.edges ?? [])],
    refs: [...(result?.refs ?? [])],
  };

  for (const plugin of plugins) {
    if (await plugin.detect({ repoRoot, result: current })) {
      const next = await plugin.enrich({ repoRoot, result: current });
      current = {
        nodes: [...(next?.nodes ?? current.nodes)],
        edges: [...(next?.edges ?? current.edges)],
        refs: [...(next?.refs ?? current.refs)],
      };
    }
  }

  return current;
}
