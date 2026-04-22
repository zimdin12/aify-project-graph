// Framework plugin smoke tests — confirm each plugin parses its
// canonical shape into Route nodes + INVOKES refs. Per-framework edge
// cases (chained middleware, resource options, Spring RequestMethod
// tail) covered inline.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pythonWebPlugin } from '../../../mcp/stdio/ingest/frameworks/python_web.js';
import { nodeWebPlugin } from '../../../mcp/stdio/ingest/frameworks/node_web.js';
import { nestjsPlugin } from '../../../mcp/stdio/ingest/frameworks/nestjs.js';
import { railsPlugin } from '../../../mcp/stdio/ingest/frameworks/rails.js';
import { springPlugin } from '../../../mcp/stdio/ingest/frameworks/spring.js';

async function fresh() {
  const repo = await mkdtemp(join(tmpdir(), 'apg-fx-'));
  const cleanup = async () => {
    for (let i = 0; i < 5; i += 1) {
      try { await rm(repo, { recursive: true, force: true }); return; } catch {}
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  return { repo, cleanup };
}

describe('python_web plugin', () => {
  let repo, cleanup;
  beforeEach(async () => ({ repo, cleanup } = await fresh()));
  afterEach(() => cleanup());

  it('extracts FastAPI decorator routes + Depends PASSES_THROUGH', async () => {
    await writeFile(join(repo, 'requirements.txt'), 'fastapi\n');
    await writeFile(join(repo, 'main.py'),
`from fastapi import FastAPI, Depends
app = FastAPI()

def get_db(): pass

@app.get("/users/{id}")
async def read_user(id: int, db = Depends(get_db)):
    return {"id": id}
`);
    expect(await pythonWebPlugin.detect({ repoRoot: repo })).toBe(true);
    const out = await pythonWebPlugin.enrich({ repoRoot: repo, result: { nodes: [], edges: [], refs: [] } });
    const routeLabels = out.nodes.filter(n => n.type === 'Route').map(n => n.label);
    expect(routeLabels).toContain('GET /users/{id}');
    const invokes = out.refs.find(r => r.relation === 'INVOKES' && r.target === 'read_user');
    expect(invokes).toBeDefined();
    const depends = out.refs.find(r => r.relation === 'PASSES_THROUGH' && r.target === 'get_db');
    expect(depends).toBeDefined();
  });

  it('extracts Flask @app.route with methods list', async () => {
    await writeFile(join(repo, 'requirements.txt'), 'flask\n');
    await writeFile(join(repo, 'app.py'),
`from flask import Flask
app = Flask(__name__)

@app.route('/login', methods=['GET', 'POST'])
def login(): pass
`);
    const out = await pythonWebPlugin.enrich({ repoRoot: repo, result: { nodes: [], edges: [], refs: [] } });
    const labels = out.nodes.filter(n => n.type === 'Route').map(n => n.label);
    expect(labels).toContain('GET /login');
    expect(labels).toContain('POST /login');
  });
});

describe('node_web plugin (Express)', () => {
  let repo, cleanup;
  beforeEach(async () => ({ repo, cleanup } = await fresh()));
  afterEach(() => cleanup());

  it('extracts app.get routes + middleware chain', async () => {
    await writeFile(join(repo, 'package.json'), JSON.stringify({
      name: 'x', dependencies: { express: '^4.0.0' },
    }));
    await writeFile(join(repo, 'server.js'),
`const express = require('express');
const app = express();
function authMw(req, res, next) { next(); }
function rateLimit(req, res, next) { next(); }
function getUsers(req, res) { res.json([]); }
app.get('/users', authMw, rateLimit, getUsers);
`);
    expect(await nodeWebPlugin.detect({ repoRoot: repo })).toBe(true);
    const out = await nodeWebPlugin.enrich({ repoRoot: repo, result: { nodes: [], edges: [], refs: [] } });
    expect(out.nodes.some(n => n.label === 'GET /users')).toBe(true);
    expect(out.refs.find(r => r.relation === 'INVOKES' && r.target === 'getUsers')).toBeDefined();
    const passEdges = out.refs.filter(r => r.relation === 'PASSES_THROUGH');
    expect(passEdges.some(r => r.target === 'authMw')).toBe(true);
    expect(passEdges.some(r => r.target === 'rateLimit')).toBe(true);
    expect(passEdges.some(r => r.target === 'getUsers')).toBe(true);
  });
});

describe('nestjs plugin', () => {
  let repo, cleanup;
  beforeEach(async () => ({ repo, cleanup } = await fresh()));
  afterEach(() => cleanup());

  it('extracts @Controller + @Get + @UseGuards chain', async () => {
    await writeFile(join(repo, 'package.json'), JSON.stringify({
      name: 'x', dependencies: { '@nestjs/core': '^10.0.0', '@nestjs/common': '^10.0.0' },
    }));
    await mkdir(join(repo, 'src'), { recursive: true });
    await writeFile(join(repo, 'src', 'users.controller.ts'),
`@UseGuards(AuthGuard)
@Controller('users')
export class UsersController {
  @Get(':id')
  findOne(@Param('id') id: string) { return id; }
}
`);
    expect(await nestjsPlugin.detect({ repoRoot: repo })).toBe(true);
    const out = await nestjsPlugin.enrich({ repoRoot: repo, result: { nodes: [], edges: [], refs: [] } });
    expect(out.nodes.some(n => n.label === 'GET /users/:id')).toBe(true);
    expect(out.refs.find(r => r.relation === 'INVOKES' && r.target === 'findOne')).toBeDefined();
    expect(out.refs.some(r => r.relation === 'PASSES_THROUGH' && r.target === 'AuthGuard')).toBe(true);
  });
});

describe('rails plugin', () => {
  let repo, cleanup;
  beforeEach(async () => ({ repo, cleanup } = await fresh()));
  afterEach(() => cleanup());

  it('expands resources :posts into 7 routes', async () => {
    await writeFile(join(repo, 'Gemfile'), `gem 'rails', '~> 7.0'\n`);
    await mkdir(join(repo, 'config'), { recursive: true });
    await writeFile(join(repo, 'config', 'routes.rb'),
`Rails.application.routes.draw do
  resources :posts
end
`);
    expect(await railsPlugin.detect({ repoRoot: repo })).toBe(true);
    const out = await railsPlugin.enrich({ repoRoot: repo, result: { nodes: [], edges: [], refs: [] } });
    const labels = out.nodes.filter(n => n.type === 'Route').map(n => n.label).sort();
    // 7 standard actions (with two update methods, PATCH + PUT → 8 entries).
    expect(labels).toContain('GET /posts');
    expect(labels).toContain('POST /posts');
    expect(labels).toContain('GET /posts/:id');
    expect(labels).toContain('DELETE /posts/:id');
  });

  it('honors only: filter', async () => {
    await writeFile(join(repo, 'Gemfile'), `gem 'rails'\n`);
    await mkdir(join(repo, 'config'), { recursive: true });
    await writeFile(join(repo, 'config', 'routes.rb'),
`Rails.application.routes.draw do
  resources :users, only: [:index, :show]
end
`);
    const out = await railsPlugin.enrich({ repoRoot: repo, result: { nodes: [], edges: [], refs: [] } });
    const labels = out.nodes.filter(n => n.type === 'Route').map(n => n.label).sort();
    expect(labels).toEqual(['GET /users', 'GET /users/:id']);
  });

  it('expands namespace :api { resources :posts } with prefix', async () => {
    await writeFile(join(repo, 'Gemfile'), `gem 'rails'\n`);
    await mkdir(join(repo, 'config'), { recursive: true });
    await writeFile(join(repo, 'config', 'routes.rb'),
`Rails.application.routes.draw do
  namespace :api do
    resources :posts, only: [:index]
  end
end
`);
    const out = await railsPlugin.enrich({ repoRoot: repo, result: { nodes: [], edges: [], refs: [] } });
    const labels = out.nodes.filter(n => n.type === 'Route').map(n => n.label);
    expect(labels).toContain('GET /api/posts');
  });
});

describe('spring plugin', () => {
  let repo, cleanup;
  beforeEach(async () => ({ repo, cleanup } = await fresh()));
  afterEach(() => cleanup());

  it('extracts @RestController + @RequestMapping prefix + @GetMapping', async () => {
    await writeFile(join(repo, 'pom.xml'), `<project><dependencies><dependency><artifactId>spring-boot-starter-web</artifactId></dependency></dependencies></project>`);
    await mkdir(join(repo, 'src'), { recursive: true });
    await writeFile(join(repo, 'src', 'UserController.java'),
`@RestController
@RequestMapping("/api/users")
public class UserController {
    @GetMapping("/{id}")
    public User find(@PathVariable Long id) { return null; }

    @PostMapping
    public User create(@RequestBody User u) { return u; }
}
`);
    expect(await springPlugin.detect({ repoRoot: repo })).toBe(true);
    const out = await springPlugin.enrich({ repoRoot: repo, result: { nodes: [], edges: [], refs: [] } });
    const labels = out.nodes.filter(n => n.type === 'Route').map(n => n.label).sort();
    expect(labels).toContain('GET /api/users/{id}');
    expect(labels).toContain('POST /api/users');
    const findInvoke = out.refs.find(r => r.relation === 'INVOKES' && r.target === 'find');
    expect(findInvoke).toBeDefined();
  });
});
