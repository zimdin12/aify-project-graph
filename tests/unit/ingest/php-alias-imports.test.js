// #4: a PHP `use X as Y` import is identified by X, and a reference to Y is a reference to X.
//
// Measured on BookStack 0b6b667 (a real Laravel application, 1846 PHP files): all 56 aliased use clauses produced an
// IMPORTS target still carrying " as Y", which can never resolve, and 82 type or class references named the alias
// instead of the class it stands for. The control is the plain `use` import, whose target was already right.
import { describe, it, expect } from 'vitest';
import { extractFile } from '../../../mcp/stdio/ingest/extractors/generic.js';
import { getLanguageConfig } from '../../../mcp/stdio/ingest/languages/index.js';

const SOURCE = String.raw`<?php
namespace App\Http;

use App\Services\Billing as B;
use App\Models\User;
use App\{Concerns\Audits as Audit, Support\Clock};
use Illuminate\Contracts\Validation\Validator as ValidatorContract;

class Other extends B
{
    public function run(B $b, User $u, Audit $a): void
    {
        $v = app(ValidatorContract::class);
    }
}
`;
const out = extractFile({ filePath: 'app/Http/Other.php', source: SOURCE, config: getLanguageConfig('app/Http/Other.php') });
const targets = (relation) => out.refs.filter((r) => r.relation === relation).map((r) => r.target);

describe('aliased PHP imports are identified by the imported name', () => {
  it('★★★ IMPORTS targets are the fully qualified names, never "X as Y"; the plain import is unchanged', () => {
    expect(targets('IMPORTS').sort()).toEqual([
      String.raw`App\Concerns\Audits`, String.raw`App\Models\User`, String.raw`App\Services\Billing`,
      String.raw`App\Support\Clock`, String.raw`Illuminate\Contracts\Validation\Validator`,
    ]);
  });

  it('★★★ a type, parent or class-constant reference to an alias names the class it stands for', () => {
    expect(targets('USES_TYPE')).toEqual(expect.arrayContaining([String.raw`App\Services\Billing`, String.raw`App\Concerns\Audits`, 'User']));
    expect(targets('EXTENDS')).toEqual([String.raw`App\Services\Billing`]);
    expect(targets('REFERENCES')).toContain(String.raw`Illuminate\Contracts\Validation\Validator`);
    const aliases = ['B', 'Audit', 'ValidatorContract'];
    const leftover = out.refs.filter((r) => aliases.includes(r.target));
    expect(leftover.map((r) => `${r.relation} ${r.target}`), 'no reference may still name an alias').toEqual([]);
  });
});
