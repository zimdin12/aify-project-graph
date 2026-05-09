export async function runCodeIntelCmd(args) {
  const sub = args[0];
  if (!sub || sub === '--help' || sub === '-h') {
    console.log('Usage: apg code-intel <subcommand>');
    console.log('Subcommands:');
    console.log('  collect <language> [--scope changed|files|all] [--files ...] [--project-root <dir>]');
    console.log('  doctor [<language>]');
    return 0;
  }
  console.error(`apg code-intel: unknown subcommand '${sub}' (stub — Tasks 6+ implement)`);
  return 2;
}
