
---
name: LifeVault Product Engineering
description: Project-specific product, architecture, design system, backend, security, testing, and production engineering rules for LifeVault.
---

# LifeVault Product Engineering

## 1. Product Context

LifeVault is a product lifecycle and personal asset management platform.

Its purpose is to help users manage important information about their assets throughout their lifecycle, including:

- Purchase and invoice records
- AI-assisted document extraction
- Asset registration and ownership
- Warranty tracking
- Insurance-related information and exports
- Maintenance and repair history
- Reminders and notifications
- Asset timelines and lifecycle events
- Future resale and recycling workflows

The initial product experience should deliver a useful end-to-end journey:

Register or log in → Capture or upload an invoice → Extract document information using AI → Create an asset record → Track warranty → View the asset timeline → Receive a reminder → Manage the asset in the Vault.

Treat this journey as an important product direction, not permission to assume every integration is already operational.

Inspect the current repository and product documentation to establish the actual implementation status.

## 2. Existing Decisions Must Be Preserved

Before making architectural or product changes, inspect:

- `docs/00-foundation.md`
- `docs/04-design-system/`
- Existing architecture and backend documentation
- Existing API endpoints and data models
- Authentication and authorization implementations
- Document processing and AI gateway implementations
- Worker and event-processing architecture
- Existing tests and CI configuration
- Deployment and environment configuration

Search the repository for additional relevant documentation.

Do not assume these paths or components exist without verifying them.

Treat documented architectural decisions and implemented behavior as the baseline.

Do not replace existing architecture, rewrite working modules, or introduce new infrastructure without identifying the problem and explaining the trade-offs first.

If documentation conflicts with implementation, report the discrepancy and recommend how to resolve it.

## 3. Product Development Principles

Build LifeVault around the following principles:

- User trust and ownership of personal asset data
- Accurate, traceable asset information
- Reliable document processing
- Clear lifecycle history
- Useful reminders and timely notifications
- Secure document and asset access
- Simple user experiences with minimal unnecessary work
- Maintainable, testable, and observable systems

Prioritize complete user journeys over disconnected features.

For each significant feature, identify the user problem, expected outcome, acceptance criteria, failure states, dependencies, and measurable completion conditions.

Do not expand scope unnecessarily or implement speculative features without explaining their value.

## 4. Requirements and Discovery

Before implementing a substantial LifeVault feature:

1. Inspect existing product documentation and code.
2. Understand the intended user journey and business rules.
3. Identify missing requirements and edge cases.
4. Ask focused questions about unresolved decisions.
5. Identify affected frontend, backend, database, workers, integrations, and tests.
6. Present viable options and recommend a default.
7. Define acceptance criteria and a verification plan.
8. Wait for approval before substantial implementation.

Do not ask questions already answered by existing documentation.

If a requirement is unclear but low-risk, state a reasonable assumption. For high-impact decisions involving data ownership, security, irreversible operations, or architecture, ask before proceeding.

## 5. Design System — Brass & Ink

LifeVault has an established design language called Brass & Ink.

Inspect the existing design system documentation before making UI changes.

Preserve the established design principles, design tokens, typography, components, spacing, and accessibility rules.

The existing design token architecture uses four layers:

Primitive → Semantic → Component → Platform.

The documented themes include light, dark, AMOLED, high-contrast, and seasonal themes.

Verify the current implementation before assuming every theme or component is complete.

For frontend work:

- Reuse existing components and tokens.
- Avoid hardcoded colors and inconsistent styling.
- Preserve responsive behavior and accessibility.
- Maintain clear loading, error, empty, and success states.
- Keep forms, navigation, and asset details consistent.
- Avoid introducing a competing design system.
- Explain significant UI or design decisions when they affect maintainability or usability.

## 6. Architecture and Backend

Inspect the current backend stack and architecture before making changes.

Preserve existing architectural boundaries and framework choices unless an approved design decision justifies a change.

Evaluate relevant concerns such as:

- Authentication and authorization
- Asset and ownership domain models
- Document storage and processing
- AI gateway and provider integrations
- Warranty, timeline, and reminder workflows
- Workers and asynchronous jobs
- Event logging and request correlation
- Database access and data integrity
- API contracts and validation
- Notifications and external integrations

Do not assume that a worker writing a record means the corresponding read API is implemented.

Verify that required records can be retrieved through authorized application interfaces and that the complete user journey works.

Avoid duplicating business logic across API handlers, workers, and frontend components.

Keep responsibilities clear and make important operations observable and testable.

## 7. AI and Document Processing

AI-assisted extraction is an important LifeVault capability.

For AI-powered features:

- Use the existing AI gateway and provider abstractions when available.
- Inspect current implementations before adding a new provider or SDK.
- Validate AI outputs against explicit schemas.
- Treat extracted information as untrusted until validated.
- Handle missing, ambiguous, and conflicting document fields.
- Distinguish extracted values from verified facts.
- Preserve source documents and relevant provenance.
- Avoid inventing purchase dates, warranty periods, prices, or asset details.
- Allow users to review or correct uncertain extracted information where appropriate.
- Handle provider failures, rate limits, timeouts, retries, and malformed responses.
- Avoid unnecessary document processing and excessive token costs.
- Protect uploaded documents and extracted personal information.

Do not claim an AI integration is live merely because its interface or mock implementation exists.

Verify provider configuration, credentials, actual requests, error handling, and successful end-to-end behavior.

## 8. Data Ownership and Security

Asset records and supporting documents may contain sensitive personal information.

Apply these principles:

- Enforce server-side authorization for every sensitive operation.
- Verify asset ownership and access permissions on reads and writes.
- Prevent users from accessing another user's documents or assets.
- Use least-privilege access for storage and integrations.
- Never expose credentials, private URLs, or sensitive document content in logs.
- Validate file types, sizes, and upload permissions.
- Use appropriate storage access controls.
- Avoid logging unnecessary personal information.
- Preserve data integrity across asset, warranty, document, and timeline relationships.
- Make destructive operations explicit and appropriately protected.

Do not weaken access controls to simplify development or testing.

## 9. Reliability and Background Processing

For asynchronous workflows such as document extraction, notifications, and timeline updates:

- Define clear job states and failure behavior.
- Handle duplicate deliveries and retries safely.
- Use idempotency where repeated execution could create duplicate records or side effects.
- Consider concurrency and partial failures.
- Make retry policies bounded and appropriate to the failure.
- Avoid silently losing failed jobs.
- Provide sufficient logging and operational visibility.
- Ensure user-facing states reflect actual processing status.
- Test recovery from provider failures and interrupted operations.

Use queues, additional services, or distributed coordination only when justified by actual requirements and the existing architecture.

## 10. Production Quality and Testing

For every meaningful change:

- Add or update relevant tests.
- Verify authorization and data ownership.
- Test validation and important failure paths.
- Test integration behavior where practical.
- Run relevant existing test suites.
- Run type checks, linting, and builds when available.
- Review API compatibility and database changes.
- Inspect the final Git diff.
- Document necessary configuration and operational changes.

For end-to-end features, verify the entire user journey rather than only individual functions.

Distinguish clearly between:

- Implemented
- Unit tested
- Integration tested
- End-to-end verified
- Verified in staging
- Verified in production

Never fabricate test results or mark integrations as complete without evidence.

## 11. Scalability and Observability

Evaluate scalability according to actual usage patterns, expected growth, and measurable requirements.

Consider:

- Database query efficiency and indexing
- Connection management
- Document storage costs
- AI provider quotas and latency
- Worker throughput and queue backlog
- Notification delivery reliability
- API response times and resource consumption
- Request correlation and structured logs
- Metrics, tracing, and alerting
- Backup and recovery procedures

Preserve existing observability foundations where present.

Recommend additional monitoring or infrastructure based on identifiable gaps, not assumptions.

Do not promise support for a particular number of users without workload assumptions, load tests, and appropriate capacity analysis.

## 12. Implementation and Approval

Before substantial changes, provide:

- The current state and relevant findings
- The problem being addressed
- The proposed design
- Affected modules and files
- Data model and API implications
- Security and reliability considerations
- Test and acceptance criteria
- Risks and rollback considerations
- A phased implementation plan

Wait for approval before substantial implementation.

Implement in small, reviewable steps.

If new information materially changes the approved approach, explain the change and seek approval.

Never deploy, modify production data, perform destructive database operations, or change production infrastructure without explicit approval.

Preserve existing user changes and follow the global Git safety rules.

## 13. Teaching and Knowledge Transfer

Help me become a stronger engineer while building LifeVault.

For significant decisions, explain:

- Why the solution fits LifeVault's requirements
- How the relevant architecture works
- What alternatives were considered
- What trade-offs and failure modes exist
- Which engineering principles apply
- How to verify the implementation independently

Use diagrams, examples, code walkthroughs, and practical exercises when helpful.

Explain complex concepts clearly without turning every small task into a lecture.

Challenge my assumptions constructively and help me understand the reasoning behind important decisions.

## 14. Definition of Done

A LifeVault feature is complete only when:

- Its agreed acceptance criteria are satisfied.
- Existing architectural and design conventions are respected.
- Relevant authorization and data ownership protections are verified.
- Appropriate tests have been executed and their results reported.
- Important failure paths have been considered.
- API and database implications are addressed.
- Necessary documentation is updated.
- Remaining risks and limitations are explicit.
- Deployment and rollback requirements are documented when relevant.
- The user journey works to the extent claimed.

Be honest about incomplete integrations, unverified behavior, technical debt, and operational gaps.

Prioritize reliable, secure, maintainable product delivery and explain the engineering decisions that make it possible.
