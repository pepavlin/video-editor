import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Validates that Dockerfiles stay in sync with workspace package dependencies.
 * When a workspace package is added as a dependency, the corresponding
 * Dockerfile must also copy and build that package.
 */

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function readFile(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf-8');
}

function parsePackageJson(relativePath: string) {
  return JSON.parse(readFile(relativePath));
}

/** Extract workspace dependency names (packages starting with @video-editor/) */
function getWorkspaceDeps(pkgJsonPath: string): string[] {
  const pkg = parsePackageJson(pkgJsonPath);
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  return Object.keys(deps).filter((d) => d.startsWith('@video-editor/'));
}

/** Convert @video-editor/shared -> packages/shared */
function depToPackagePath(dep: string): string {
  const name = dep.replace('@video-editor/', '');
  return `packages/${name}`;
}

describe('Dockerfile consistency', () => {
  describe('web Dockerfile', () => {
    it('should copy package.json for all workspace dependencies', () => {
      const dockerfile = readFile('apps/web/Dockerfile');
      const deps = getWorkspaceDeps('apps/web/package.json');

      for (const dep of deps) {
        const pkgPath = depToPackagePath(dep);
        expect(dockerfile).toContain(
          `${pkgPath}/package.json`,
        );
      }
    });

    it('should build all workspace dependencies before building web', () => {
      const dockerfile = readFile('apps/web/Dockerfile');
      const deps = getWorkspaceDeps('apps/web/package.json');

      for (const dep of deps) {
        const name = dep.replace('@video-editor/', '');
        // Check that the package is built (either as separate command or chained)
        expect(dockerfile).toContain(
          `packages/${name}`,
        );
      }

      // Verify build order: shared and elements must be built before web
      const buildSharedIdx = dockerfile.indexOf('build -w packages/shared');
      const buildWebIdx = dockerfile.indexOf('build -w apps/web');
      expect(buildSharedIdx).toBeGreaterThan(-1);
      expect(buildWebIdx).toBeGreaterThan(-1);
      expect(buildSharedIdx).toBeLessThan(buildWebIdx);
    });

    it('should copy source files for workspace dependencies', () => {
      const dockerfile = readFile('apps/web/Dockerfile');
      const deps = getWorkspaceDeps('apps/web/package.json');

      for (const dep of deps) {
        const pkgPath = depToPackagePath(dep);
        // Should copy either specific files or the whole directory
        const copiesSource =
          dockerfile.includes(`COPY ${pkgPath}/src`) ||
          dockerfile.includes(`COPY ${pkgPath} `);
        expect(copiesSource).toBe(true);
      }
    });
  });

  describe('api Dockerfile', () => {
    it('should copy package.json for all workspace dependencies', () => {
      const dockerfile = readFile('apps/api/Dockerfile');
      const deps = getWorkspaceDeps('apps/api/package.json');

      for (const dep of deps) {
        const pkgPath = depToPackagePath(dep);
        expect(dockerfile).toContain(
          `${pkgPath}/package.json`,
        );
      }
    });

    it('should build all workspace dependencies before building api', () => {
      const dockerfile = readFile('apps/api/Dockerfile');
      const deps = getWorkspaceDeps('apps/api/package.json');

      for (const dep of deps) {
        const name = dep.replace('@video-editor/', '');
        expect(dockerfile).toContain(
          `packages/${name}`,
        );
      }

      // Verify build order: shared must be built before api
      const buildSharedIdx = dockerfile.indexOf('build -w packages/shared');
      const buildApiIdx = dockerfile.indexOf('build -w apps/api');
      expect(buildSharedIdx).toBeGreaterThan(-1);
      expect(buildApiIdx).toBeGreaterThan(-1);
      expect(buildSharedIdx).toBeLessThan(buildApiIdx);
    });
  });

  describe('docker-compose.yml', () => {
    it('should reference the correct Dockerfiles', () => {
      const compose = readFile('docker-compose.yml');
      expect(compose).toContain('apps/api/Dockerfile');
      expect(compose).toContain('apps/web/Dockerfile');
    });

    it('should set build context to project root', () => {
      const compose = readFile('docker-compose.yml');
      // Both services should use root context (.) for monorepo access
      expect(compose).toContain('context: .');
    });
  });
});
