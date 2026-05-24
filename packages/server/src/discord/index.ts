export { DiscordDeliveryGateway } from "./discord-gateway.js";
export type { DiscordGatewayDeps } from "./discord-gateway.js";
export {
  parseDiscordGatewayConfig,
  validateDiscordGatewayConfig,
} from "./discord-config.js";
export type {
  DiscordGatewayConfig,
  DiscordPersonaBotConfig,
  DiscordSetupMode,
  RawDiscordGatewayConfig,
} from "./discord-config.js";
export { classifyDiscordError, isRetryable } from "./discord-errors.js";
export type { DiscordErrorKind, ClassifiedDiscordError } from "./discord-errors.js";
export { BotRegistry } from "./bot-registry.js";
export type { PersonaBotHandle, BotRegistryDeps } from "./bot-registry.js";
export { ChannelMap } from "./channel-map.js";
export type { DiscordChannelMapEntry } from "./channel-map.js";
export { DiscordRoleManager } from "./role-manager.js";
export type { RoleManagerDeps } from "./role-manager.js";
export {
  formatDeliveryMessage,
  formatSpectatorEvent,
  formatOperatorEvent,
} from "./discord-formatter.js";
export type { DiscordFormattedMessage } from "./discord-formatter.js";
export { DiscordRateLimiter } from "./discord-rate-limiter.js";
export type {
  OutboundDiscordMessage,
  DiscordSendFn,
  RateLimiterConfig,
} from "./discord-rate-limiter.js";
export type {
  DiscordGuildPort,
  DiscordTextChannelPort,
  DiscordRolePort,
  DiscordMemberPort,
  PermissionName,
  PermissionOverwriteInput,
  CreateTextChannelInput,
} from "./discord-guild-port.js";
export { DiscordJsGuildAdapter } from "./discord-guild-adapter.js";
