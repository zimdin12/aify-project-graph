// Plan #17 C tests: Django route extractor.
// Covers path() / re_path() / url(), bare-function / class-based /
// dotted-string handlers, include() suppression, multi-route files.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { djangoPlugin } from '../../../mcp/stdio/ingest/frameworks/django.js';

function tmpDjangoRepo(filesByRelPath) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-django-'));
  // Required for djangoPlugin.detect()
  fs.writeFileSync(path.join(dir, 'requirements.txt'), 'Django==5.0\n');
  for (const [rel, content] of Object.entries(filesByRelPath)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

async function runPlugin(repoRoot) {
  return djangoPlugin.enrich({ repoRoot, result: { nodes: [], edges: [], refs: [] } });
}

describe('django route plugin — detect', () => {
  it('detects when Django is listed in requirements.txt', async () => {
    const dir = tmpDjangoRepo({ 'urls.py': '' });
    expect(await djangoPlugin.detect({ repoRoot: dir })).toBe(true);
  });

  it('detects via manage.py', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-django-mp-'));
    fs.writeFileSync(path.join(dir, 'manage.py'), '#!/usr/bin/env python\nimport django\n');
    expect(await djangoPlugin.detect({ repoRoot: dir })).toBe(true);
  });

  it('does not detect when only Flask is present', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-django-no-'));
    fs.writeFileSync(path.join(dir, 'requirements.txt'), 'Flask==2.0\n');
    expect(await djangoPlugin.detect({ repoRoot: dir })).toBe(false);
  });
});

describe('django route plugin — extract', () => {
  it('extracts path() with bare function handler', async () => {
    const dir = tmpDjangoRepo({
      'app/urls.py': [
        'from django.urls import path',
        'from . import views',
        '',
        'urlpatterns = [',
        "    path('articles/', views.index, name='article-list'),",
        ']',
      ].join('\n'),
    });
    const r = await runPlugin(dir);
    expect(r.nodes.length).toBe(1);
    expect(r.nodes[0].label).toBe('ANY articles/');
    expect(r.refs.length).toBe(1);
    expect(r.refs[0].target).toBe('index');
    expect(r.refs[0].relation).toBe('INVOKES');
  });

  it('extracts re_path() with regex pattern', async () => {
    const dir = tmpDjangoRepo({
      'app/urls.py': [
        'from django.urls import re_path',
        'from . import views',
        '',
        'urlpatterns = [',
        "    re_path(r'^articles/(?P<year>[0-9]{4})/$', views.year_archive),",
        ']',
      ].join('\n'),
    });
    const r = await runPlugin(dir);
    expect(r.nodes.length).toBe(1);
    expect(r.nodes[0].label).toMatch(/year/);
    expect(r.refs[0].target).toBe('year_archive');
  });

  it('extracts class-based view via .as_view()', async () => {
    const dir = tmpDjangoRepo({
      'app/urls.py': [
        'from django.urls import path',
        'from .views import ArticleListView',
        '',
        'urlpatterns = [',
        "    path('articles/', ArticleListView.as_view(), name='article-list'),",
        ']',
      ].join('\n'),
    });
    const r = await runPlugin(dir);
    expect(r.refs.length).toBe(1);
    expect(r.refs[0].target).toBe('ArticleListView');
  });

  it('extracts dotted-string handler (legacy syntax)', async () => {
    const dir = tmpDjangoRepo({
      'app/urls.py': [
        'from django.conf.urls import url',
        '',
        'urlpatterns = [',
        "    url(r'^articles/$', 'app.views.archive'),",
        ']',
      ].join('\n'),
    });
    const r = await runPlugin(dir);
    expect(r.refs.length).toBe(1);
    expect(r.refs[0].target).toBe('archive');
  });

  it('does NOT emit a route node for include() calls', async () => {
    const dir = tmpDjangoRepo({
      'project/urls.py': [
        'from django.urls import path, include',
        '',
        'urlpatterns = [',
        "    path('blog/', include('blog.urls')),",
        ']',
      ].join('\n'),
    });
    const r = await runPlugin(dir);
    expect(r.nodes.length).toBe(0);
    expect(r.refs.length).toBe(0);
  });

  it('handles multiple routes in one urls.py', async () => {
    const dir = tmpDjangoRepo({
      'app/urls.py': [
        'from django.urls import path, re_path',
        'from . import views',
        '',
        'urlpatterns = [',
        "    path('articles/', views.index, name='article-list'),",
        "    path('articles/<int:year>/', views.year_archive, name='article-year'),",
        "    re_path(r'^search/$', views.search),",
        ']',
      ].join('\n'),
    });
    const r = await runPlugin(dir);
    expect(r.nodes.length).toBe(3);
    expect(r.refs.length).toBe(3);
    expect(r.refs.map(x => x.target).sort()).toEqual(['index', 'search', 'year_archive']);
  });

  it('only scans files named urls.py (other .py files ignored)', async () => {
    const dir = tmpDjangoRepo({
      'app/views.py': [
        '# This file mentions path() in a docstring, must not be parsed',
        "# path('articles/', views.x)",
      ].join('\n'),
    });
    const r = await runPlugin(dir);
    expect(r.nodes.length).toBe(0);
  });

  it('skips files whose urls.py has no path/re_path/url calls', async () => {
    const dir = tmpDjangoRepo({
      'app/urls.py': '# empty router\nurlpatterns = []\n',
    });
    const r = await runPlugin(dir);
    expect(r.nodes.length).toBe(0);
  });
});
