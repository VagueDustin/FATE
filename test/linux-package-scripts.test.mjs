// The .deb/.rpm maintainer scripts in build/linux/, run for real (bash) against a throwaway root.
//
// They run as root on users' machines, so the remove scripts are exercised rather than just read:
// each scenario substitutes electron-builder's two macros the way FpmTarget does, points every
// absolute path (/etc, /opt, /usr/bin) into a temp directory, and runs the script with a PATH of
// stubs (update-alternatives, apparmor_status, apparmor_parser) that record what they were asked
// to do. Static checks cover what the run can't: the macro rule electron-builder enforces, no
// percent signs in rpm scriptlets, and the package.json wiring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const linuxDir = join(root, 'build', 'linux');
const read = (name) => readFileSync(join(linuxDir, name), 'utf8');

const EXECUTABLE = pkg.build.executableName;
const PRODUCT_DIR = pkg.build.productName; // sanitize-filename leaves this name as it is
const SOURCES_MARKED =
  '# FATE - Formatted Article & Text Editor. Added by the fate package so `apt upgrade` keeps it\n' +
  'Types: deb\nSigned-By: /usr/share/keyrings/fate-archive-keyring.gpg\n';
const SOURCES_FROM_RELEASE =
  '# FATE - Formatted Article & Text Editor: apt repository (served from GitHub Releases).\n' +
  'Types: deb\nSigned-By: /usr/share/keyrings/fate-archive-keyring.gpg\n';
const SOURCES_USER = 'Types: deb\nURIs: https://example.invalid/\nSuites: apt/\n';
const REPO_MARKED =
  '# FATE - Formatted Article & Text Editor. Added by the fate package so `dnf upgrade` keeps it\n[fate]\n';
const REPO_FROM_RELEASE = '[fate]\nname=FATE - Formatted Article & Text Editor\n';

/** electron-builder's writeConfigFile: ${name} macros, unknown names are a build failure. */
function substitute(text) {
  const values = { executable: EXECUTABLE, sanitizedProductName: PRODUCT_DIR };
  return text.replace(/\${([a-zA-Z]+)}/g, (_m, name) => {
    if (!(name in values)) throw new Error(`macro ${name} is not defined`);
    return values[name];
  });
}

const haveBash = process.platform !== 'win32' && spawnSync('bash', ['-c', 'true']).status === 0;
const which = (cmd) => execFileSync('bash', ['-c', `command -v ${cmd}`], { encoding: 'utf8' }).trim();
const BASH = haveBash ? which('bash') : 'bash';

/** A scratch root with stub tools; returns helpers to run a script inside it. */
function sandbox({ apparmor = false, alternativesFails = false, withAlternatives = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'fate-pkg-scripts-'));
  const bin = join(dir, 'stub-bin');
  const log = join(dir, 'calls.log');
  mkdirSync(bin);
  // Only these real tools are reachable, so a real update-alternatives on the host (Debian CI
  // runners have one) can never be called.
  for (const tool of ['grep', 'rm', 'ln']) symlinkSync(which(tool), join(bin, tool));
  const stub = (name, body) => {
    writeFileSync(join(bin, name), `#!/bin/bash\necho "${name} $*" >> '${log}'\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  if (withAlternatives) {
    stub(
      'update-alternatives',
      alternativesFails
        ? 'exit 2'
        : `case "$1" in --install) ln -sf "$4" "$2" ;; --remove) rm -f '${dir}/usr/bin/${EXECUTABLE}' ;; esac`,
    );
  }
  stub('apparmor_status', apparmor ? 'exit 0' : 'exit 1');
  stub('apparmor_parser', 'exit 0');
  for (const d of ['etc/apt/sources.list.d', 'etc/yum.repos.d', 'etc/apparmor.d', 'usr/bin', `opt/${PRODUCT_DIR}`]) {
    mkdirSync(join(dir, d), { recursive: true });
  }
  const exe = join(dir, 'opt', PRODUCT_DIR, EXECUTABLE);
  writeFileSync(exe, '#!/bin/sh\n');
  chmodSync(exe, 0o755);

  const at = (p) => join(dir, p);
  return {
    at,
    calls: () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []),
    run(script, args) {
      const body = substitute(read(script)).replace(/(?<![\w.])\/(etc|opt|usr\/bin)\//g, `${dir}/$1/`);
      const file = join(dir, script);
      writeFileSync(file, body);
      return spawnSync(BASH, [file, ...args], { env: { PATH: bin }, encoding: 'utf8' });
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

const linkTo = (target) => (s) => symlinkSync(target, s.at(`usr/bin/${EXECUTABLE}`));

test('the templates use only the two macros electron-builder fills in', () => {
  for (const name of ['after-install-deb.sh', 'after-install-rpm.sh', 'after-remove-deb.sh', 'after-remove-rpm.sh']) {
    const used = new Set([...read(name).matchAll(/\${([a-zA-Z]+)}/g)].map((m) => m[1]));
    for (const macro of used) assert.ok(['executable', 'sanitizedProductName'].includes(macro), `${name}: \${${macro}}`);
    assert.doesNotThrow(() => substitute(read(name)), name);
  }
});

test('rpm scriptlets contain no percent sign (rpmbuild would expand it as a macro)', () => {
  for (const name of ['after-remove-rpm.sh', 'posttrans-rpm.sh']) {
    assert.equal(read(name).includes('%'), false, name);
  }
});

test('package.json wires the scripts and the keyring into the packages', () => {
  const { deb, rpm } = pkg.build;
  assert.equal(deb.afterRemove, 'build/linux/after-remove-deb.sh');
  assert.equal(rpm.afterRemove, 'build/linux/after-remove-rpm.sh');
  assert.ok(rpm.fpm.includes('--rpm-posttrans=build/linux/posttrans-rpm.sh'));
  for (const mapping of [...deb.fpm, ...rpm.fpm].filter((m) => m.includes('='))) {
    const src = mapping.replace(/^--[^=]+=/, '').split('=')[0];
    assert.ok(existsSync(join(root, src)), `${mapping}: ${src} is missing`);
  }
});

test('posttrans spells out the same paths electron-builder installs to', () => {
  const text = read('posttrans-rpm.sh');
  assert.ok(text.includes(`FATE_EXE='/opt/${PRODUCT_DIR}/${EXECUTABLE}'`));
  assert.ok(text.includes(`/usr/bin/${EXECUTABLE}`));
});

test('every script is valid bash after substitution', { skip: !haveBash }, () => {
  for (const name of ['after-install-deb.sh', 'after-install-rpm.sh', 'after-remove-deb.sh', 'after-remove-rpm.sh', 'posttrans-rpm.sh']) {
    const r = spawnSync('bash', ['-n'], { input: substitute(read(name)), encoding: 'utf8' });
    assert.equal(r.status, 0, `${name}: ${r.stderr}`);
  }
});

const DEB_CASES = [
  { action: 'remove', sources: SOURCES_MARKED, removed: true },
  { action: 'purge', sources: SOURCES_MARKED, removed: true },
  { action: 'remove', sources: SOURCES_FROM_RELEASE, removed: true },
  { action: 'remove', sources: SOURCES_USER, removed: false },
  { action: 'upgrade', sources: SOURCES_MARKED, removed: false },
  { action: 'failed-upgrade', sources: SOURCES_MARKED, removed: false },
  { action: 'abort-install', sources: SOURCES_MARKED, removed: false },
];

for (const c of DEB_CASES) {
  const kind = c.sources === SOURCES_USER ? 'a hand-written' : c.sources === SOURCES_MARKED ? "the package's" : "the README's";
  test(`deb postrm ${c.action}: ${c.removed ? 'removes' : 'keeps'} ${kind} fate.sources`, { skip: !haveBash }, () => {
    const s = sandbox();
    try {
      writeFileSync(s.at('etc/apt/sources.list.d/fate.sources'), c.sources);
      linkTo(`/opt/${PRODUCT_DIR}/${EXECUTABLE}`)(s);
      const r = s.run('after-remove-deb.sh', [c.action]);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(existsSync(s.at('etc/apt/sources.list.d/fate.sources')), !c.removed);
      // electron-builder's own after-remove ran for every postrm call before; it still does.
      assert.deepEqual(s.calls(), [`update-alternatives --remove ${EXECUTABLE} ${s.at(`opt/${PRODUCT_DIR}/${EXECUTABLE}`)}`]);
    } finally {
      s.cleanup();
    }
  });
}

test('deb postrm unloads and deletes the AppArmor profile, and exits 0 even when a tool fails', { skip: !haveBash }, () => {
  const s = sandbox({ apparmor: true, alternativesFails: true });
  try {
    writeFileSync(s.at(`etc/apparmor.d/${EXECUTABLE}`), 'profile\n');
    const r = s.run('after-remove-deb.sh', ['remove']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(existsSync(s.at(`etc/apparmor.d/${EXECUTABLE}`)), false);
    assert.ok(s.calls().some((c) => c.startsWith('apparmor_parser --remove ')));
  } finally {
    s.cleanup();
  }
});

test('deb postrm without update-alternatives deletes the plain /usr/bin link', { skip: !haveBash }, () => {
  const s = sandbox({ withAlternatives: false });
  try {
    linkTo(`/opt/${PRODUCT_DIR}/${EXECUTABLE}`)(s);
    const r = s.run('after-remove-deb.sh', ['remove']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(existsSync(s.at(`usr/bin/${EXECUTABLE}`)), false);
  } finally {
    s.cleanup();
  }
});

test('rpm postun during an upgrade ($1 = 1) leaves the link, the profile and fate.repo alone', { skip: !haveBash }, () => {
  const s = sandbox({ apparmor: true });
  try {
    writeFileSync(s.at('etc/yum.repos.d/fate.repo'), REPO_MARKED);
    writeFileSync(s.at(`etc/apparmor.d/${EXECUTABLE}`), 'profile\n');
    linkTo(`/opt/${PRODUCT_DIR}/${EXECUTABLE}`)(s);
    const r = s.run('after-remove-rpm.sh', ['1']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(s.calls(), []);
    assert.ok(existsSync(s.at('etc/yum.repos.d/fate.repo')));
    assert.ok(existsSync(s.at(`etc/apparmor.d/${EXECUTABLE}`)));
    assert.equal(readlinkSync(s.at(`usr/bin/${EXECUTABLE}`)), `/opt/${PRODUCT_DIR}/${EXECUTABLE}`);
  } finally {
    s.cleanup();
  }
});

test('rpm postun on erase ($1 = 0) removes the alternative, the profile and the marked fate.repo', { skip: !haveBash }, () => {
  const s = sandbox({ apparmor: true });
  try {
    writeFileSync(s.at('etc/yum.repos.d/fate.repo'), REPO_MARKED);
    writeFileSync(s.at(`etc/apparmor.d/${EXECUTABLE}`), 'profile\n');
    const r = s.run('after-remove-rpm.sh', ['0']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(existsSync(s.at('etc/yum.repos.d/fate.repo')), false);
    assert.equal(existsSync(s.at(`etc/apparmor.d/${EXECUTABLE}`)), false);
    assert.ok(s.calls().includes(`update-alternatives --remove ${EXECUTABLE} ${s.at(`opt/${PRODUCT_DIR}/${EXECUTABLE}`)}`));
  } finally {
    s.cleanup();
  }
});

test("rpm postun on erase keeps the README's fate.repo, which fetches its key from GitHub", { skip: !haveBash }, () => {
  const s = sandbox();
  try {
    writeFileSync(s.at('etc/yum.repos.d/fate.repo'), REPO_FROM_RELEASE);
    const r = s.run('after-remove-rpm.sh', ['0']);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(s.at('etc/yum.repos.d/fate.repo')));
  } finally {
    s.cleanup();
  }
});

test('rpm posttrans puts back a /usr/bin link an old postun deleted', { skip: !haveBash }, () => {
  const s = sandbox();
  try {
    const r = s.run('posttrans-rpm.sh', []);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readlinkSync(s.at(`usr/bin/${EXECUTABLE}`)), s.at(`opt/${PRODUCT_DIR}/${EXECUTABLE}`));
    assert.equal(s.calls().length, 1);
    assert.match(s.calls()[0], /^update-alternatives --install /);
  } finally {
    s.cleanup();
  }
});

test('rpm posttrans does nothing when the link is there', { skip: !haveBash }, () => {
  const s = sandbox();
  try {
    linkTo(s.at(`opt/${PRODUCT_DIR}/${EXECUTABLE}`))(s);
    const r = s.run('posttrans-rpm.sh', []);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(s.calls(), []);
  } finally {
    s.cleanup();
  }
});
