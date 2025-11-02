# Development Workflow

## Setup

```bash
cd functions
npm install  # Installs all dependencies via workspaces
```

## Development (Watch Mode)

### Option 1: Develop one function
```bash
# Terminal 1: Watch shared library
npm run watch:shared

# Terminal 2: Watch your function
npm run watch:listener
```

### Option 2: Develop multiple functions
```bash
# Terminal 1: Watch shared + listener
npm run watch:shared & npm run watch:listener

# Terminal 2: Watch callback
npm run watch:callback
```

### Option 3: Orchestrated watch (recommended)
```bash
# Watch everything in one command (uses concurrently from package.json)
npm run watch:all
```

This uses the `concurrently` package already in `devDependencies` to run all watch tasks simultaneously with colored output.

## Production Build

```bash
# Build all functions for deployment
npm run build:all

# Or build individually
npm run build:listener
npm run build:callback
```

## Clean

```bash
npm run clean  # Removes all dist/ and node_modules/
```

## Architecture

- **slack-shared**: Compiled to `dist/` with declaration files (`.d.ts`)
- **message-listener**: Uses `mnemosyne-slack-shared` via file protocol
- **oauth-callback**: Uses `mnemosyne-slack-shared` via file protocol
- **file-processor**: Uses `mnemosyne-slack-shared` via file protocol

## Type Resolution Flow

1. `slack-shared` compiles to `dist/index.js` + `dist/index.d.ts`
2. Other packages reference `"mnemosyne-slack-shared": "file:../slack-shared"`
3. TypeScript finds types via `declaration: true` in slack-shared tsconfig
4. Development: `tsc -w` in slack-shared regenerates types on change
5. Build: Each function bundles dependencies via esbuild

