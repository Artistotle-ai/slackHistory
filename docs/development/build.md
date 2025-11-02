# Build Architecture - Explained

## The Problem

You want:
1. Separate builds per Lambda (no mixing)
2. Watch mode during development
3. Proper type resolution between packages
4. Clean deployment pipelines

## Current State

### Slack-Shared
- **Purpose**: Shared types/utilities for all Lambdas
- **Build**: `tsc` → `dist/` with `.d.ts` declaration files
- **Type exports**: Via `"main": "dist/index.js"` and `"types": "dist/index.d.ts"`

### Lambda Functions (message-listener, oauth-callback, file-processor)
- **Build**: `esbuild` for production bundle (minified, single file)
- **Dev**: `tsc` for type-checking (with `noEmit: false` in dev mode)
- **Dependency**: `"mnemosyne-slack-shared": "file:../slack-shared"`

## tsconfig.json Confusion

**slack-shared**: 
- `declaration: true` ✅ (needs to generate .d.ts for other packages)
- `noEmit: false` ✅ (must generate dist files)

**message-listener** (and others):
- `declaration: false` (default, doesn't generate .d.ts)
- `noEmit: false` for dev builds ✅

## Solution: Two-Stage Build

### Development
```bash
# Terminal 1: Watch shared library
cd functions/slack-shared
npm run watch  # tsc -w, regenerates dist/ with types

# Terminal 2: Watch your function
cd functions/message-listener
npm run watch  # tsc -w for type checking + dist/ for local testing
```

Types resolve via: `"mnemosyne-slack-shared": "file:../slack-shared"` → finds `slack-shared/dist/index.d.ts`

### Production
```bash
cd functions/slack-shared && npm run build  # Generate dist/
cd functions/message-listener && npm run build  # esbuild bundles everything
```

esbuild bundles src, but excludes `@aws-sdk/*` and resolves `mnemosyne-slack-shared` via file protocol.

## Fix tsconfig Files

**For message-listener, oauth-callback, file-processor:**

Remove:
- `declaration: true` (only needed in slack-shared)
- `declarationDir: "../types"`
- `declarationMap: true`

Keep:
- `noEmit: false` (so watch mode generates dist/ for local testing)

## Deployment Pipeline

The buildspec should:
1. Build slack-shared first (generates dist/)
2. Build each Lambda function
3. Bundle with esbuild
4. Package for deployment

This is already working in your buildspecs!

