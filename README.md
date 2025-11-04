# Mnemosyne - Slack History MVP

## Problem Statement

Slack's free plan automatically deletes messages older than 90 days, creating gaps in organizational knowledge and making it difficult to reference past conversations, decisions, and shared files. This limitation forces teams to choose between upgrading to a paid plan or losing valuable communication history.

## Solution & Outcome

This MVP provides **unlimited, searchable message history** for Slack workspaces without requiring a paid subscription. Once deployed, all future messages, channel metadata, and file attachments are permanently preserved and accessible, enabling teams to:

- **Retain organizational knowledge** indefinitely without message loss
- **Reference past conversations** and decisions at any time
- **Preserve file attachments** even after the original files expire
- **Maintain complete channel history** including name changes, purpose, and topic updates
- **Track threaded discussions** with efficient retrieval capabilities

## Scope & Limitations

This MVP focuses on **real-time data capture** from the point of deployment forward:

- **Forward-looking only**: Historical messages prior to deployment are not captured
- **New events only**: Captures messages and events as they occur in real-time
- **MVP scope**: Designed for early-stage teams who prioritize functionality over enterprise-grade privacy controls

## Critical Considerations

⚠️ **Privacy & Compliance**: This application stores all workspace messages, including private channel content, in cloud storage. All workspace members must explicitly understand and consent to this data retention approach. **Not recommended for organizations with strict data privacy requirements.**

⚠️ **Terms of Service Risk**: This solution may violate Slack's Terms and Conditions. Use at your own risk.

⚠️ **Enterprise Alternative**: Organizations requiring similar functionality with proper compliance controls should consider Slack's Discovery or Enterprise Grid export APIs instead.

## Target Users

Early-stage startups, small teams, and free plan workspaces where all participants understand the trade-offs and explicitly agree to comprehensive message archiving in exchange for unlimited history retention.

## Getting Started

Ready to deploy Mnemosyne? Follow the **[Get Started Guide](docs/GET_STARTED.md)** for step-by-step instructions.

The guide covers:
- Infrastructure deployment
- Slack app creation and configuration
- Secrets management
- Installation and verification

For detailed documentation, see the [Documentation Index](docs/README.md).

