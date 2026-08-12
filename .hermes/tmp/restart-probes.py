import os, shutil, subprocess, tempfile, json, sys
base=sys.argv[1]
root=tempfile.mkdtemp(prefix='apg-restart-probes-')
server='mcp/stdio/server-build.js'
test='tests/unit/query/stale-warning-actionable.test.js'
mutants={
 'guidance_insert_before': [(server, "        + RESTART_GUIDANCE\n", "        + ' Only a human operator may restart this service.'\n        + RESTART_GUIDANCE\n")],
 'guidance_insert_after': [(server, "        + RESTART_GUIDANCE\n", "        + RESTART_GUIDANCE\n        + ' Only a human operator may restart this service.'\n")],
 'guidance_reorder_before_route': [(server, "        + RESTART_GUIDANCE\n", "        + RESTART_GUIDANCE\n")],
 'guidance_common_mode': [
   (server, "  + ' this MCP child, so verify with the timestamp below rather than assuming it worked.';", "  + ' this MCP child, so verify with the timestamp below rather than assuming it worked. Only humans may restart it.';"),
   (test, "  + ' this MCP child, so verify with the timestamp below rather than assuming it worked.';", "  + ' this MCP child, so verify with the timestamp below rather than assuming it worked. Only humans may restart it.';")],
 'classifier_remove_json': [(server, "['js', 'mjs', 'cjs', 'ts', 'json']", "['js', 'mjs', 'cjs', 'ts']")],
 'classifier_remove_i': [(server, "EXECUTABLE_EXTENSIONS.join('|')})$`, 'i'", "EXECUTABLE_EXTENSIONS.join('|')})$`")],
 'classifier_remove_end_anchor': [(server, "EXECUTABLE_EXTENSIONS.join('|')})$`, 'i'", "EXECUTABLE_EXTENSIONS.join('|')})`, 'i'")],
 'classifier_match_all': [(server, "const EXECUTABLE_RE = new RegExp(`\\\\.(${EXECUTABLE_EXTENSIONS.join('|')})$`, 'i');", "const EXECUTABLE_RE = /./;")],
}
# Special reorder: move guidance before conditional block is cumbersome; insertion-before is equivalent paragraph-prefix movement anti-target.
results=[]
for name, edits in mutants.items():
 d=os.path.join(root,name); shutil.copytree(base,d,symlinks=True,ignore=shutil.ignore_patterns('node_modules'))
 # Windows junction avoids privilege requirement and gives npx dependencies.
 subprocess.run(['cmd.exe','/c','mklink','/J',os.path.join(d,'node_modules'),r'C:\Docker\aify-project-graph\node_modules'],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 ok=True
 for rel,old,new in edits:
  p=os.path.join(d,rel); s=open(p,encoding='utf8').read()
  if old not in s:
   ok=False; results.append({'probe':name,'setup_error':f'needle absent: {old}'}) ; break
  open(p,'w',encoding='utf8',newline='').write(s.replace(old,new,1))
 if not ok: continue
 cp=subprocess.run(['npx.cmd','vitest','run',test,'--reporter=dot'],cwd=d,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=180)
 evidence=[x.strip() for x in cp.stdout.splitlines() if ('Test Files' in x or 'Tests ' in x or 'AssertionError' in x or 'the restart guidance' in x or 'extension may not' in x or 'UPPER CASE' in x or 'sourcemap' in x)]
 results.append({'probe':name,'exit':cp.returncode,'evidence':evidence[-12:]})
print(json.dumps({'root':root,'results':results},indent=2))
