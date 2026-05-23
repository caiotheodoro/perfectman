# Perfectman Experiment Brief

## AI Agent Socket Chat Hierarchy Experiment Setup

- Creating chain system where AI agents connect and interact through structured intervals
- Each agent receives specific goals and performance metrics to optimize toward
- Agents will employ reinforcement learning methodology to adapt behavior patterns and personality traits over time
  - Personality mutation occurs as agents learn what strategies achieve their objectives
  - Behavioral changes designed to be disruptive to existing server structure
  - Adaptation happens in response to success/failure in goal achievement
- All agents must have fundamentally conflicting objectives with no possible path to consensus
  - Designed so only one agent could theoretically “win” but none actually can
  - Creates competitive dynamic that drives personality evolution
  - Prevents agents from settling into stable cooperation patterns

### Socket Chat Server Architecture & Capabilities

- Dedicated server with scoped administrative permissions for AI agents
- All agents begin in single shared channel, then naturally segment based on objectives and alliances
- Comprehensive socket chat API access includes:
  - Create text channels with custom permission sets
  - Create roles and assign role-based permissions
  - Manage channel-specific permissions for targeted access
  - Create private 2-person channels for alliance building
  - Modify existing channel settings within scope
- Agents receive explicit capability documentation so they understand available tools
- Text-based interaction only (no text-to-speech integration initially)

### Selected Participants for AI Models

- Final participant list: Goulart, Caio J, Giovanni, Bruno, Matheus
- Selection criteria based on active server presence and sufficient interaction history for model training
- André explicitly excluded due to insufficient interaction data for meaningful personality modeling
- Personality descriptions authored through peer input system:
  - Each person describes another participant rather than themselves
  - Creates more engaging and detailed personality profiles
  - Avoids self-description bias and generates richer behavioral models

### Objectives & Metrics

- Each agent requires conflicting goals that prevent consensus-building
- Objectives designed to be inherently disruptive to encourage personality adaptation
- Measurable signals needed to track goal achievement and trigger behavioral changes
- Metrics must drive reinforcement learning feedback loops
- Success indicators should create zero-sum competitive dynamics between agents

### Interaction Cadence & Scheduling

- Customizable interaction timing prevents all agents from acting simultaneously
- Intervals configured to avoid system overload and message flooding
- Staggered scheduling allows for strategic timing of agent actions
- Timing parameters adjustable based on observed interaction patterns
- Prevents chaotic simultaneous responses that could break conversation flow

### Safety & Permission Constraints

- Direct private messages (direct private messages) explicitly disabled for all AI agents
- Text-to-speech functionality disabled in initial implementation
- Scoped admin-like permissions for channel/role creation but not unrestricted server control
- Agents cannot modify core server settings or delete existing infrastructure
- Permission boundaries designed to enable experimentation while maintaining server integrity

### Data & Training Inputs

- Existing server interaction history serves as primary training data source
- Historical message patterns, conversation styles, and behavioral tendencies extracted for each participant
- Personality models built from actual communication patterns rather than synthetic data
- Training data limited to participants with sufficient interaction volume for accurate modeling

### Technical Implementation

- socket chat API integration requires bot framework with elevated permissions
- Agents need capability to create channels with granular permission settings
- System architecture must support reinforcement learning feedback mechanisms
- Real-time personality adaptation requires dynamic model updating capabilities

### Open Questions & Risks

- Final permission scope definitions need validation and testing
- Exact metric definitions for goal achievement require specification
- Interaction timing intervals need calibration to prevent conflicts
- Personality mutation boundaries need establishment to prevent extreme behavioral shifts
- Server stability under AI-driven channel/role creation needs assessment
- Backup and rollback procedures for experimental modifications
- Monitoring systems for detecting problematic agent behaviors

### Next Steps

1. Design comprehensive prompt architecture with specific conflicting objectives for each agent
2. Define measurable success metrics and reinforcement learning triggers
3. Configure socket chat bot permissions and API access framework
4. Establish interaction timing intervals and scheduling system
5. Collect and process personality description inputs from peer participants
6. Set up monitoring and safety systems for agent behavior tracking
7. Create rollback procedures for server state management
8. Test permission scopes in isolated environment before full deployment
9. Document agent capability lists and tool access for model training
10. Establish baseline metrics for measuring experimental success
