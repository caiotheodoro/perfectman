export type PermissionName =
  | "ViewChannel"
  | "SendMessages"
  | "ReadMessageHistory"
  | "ManageChannels"
  | "ManageRoles"
  | "AddReactions";

export type PermissionOverwriteInput = {
  id: string;
  allow?: PermissionName[];
  deny?: PermissionName[];
};

export type CreateTextChannelInput = {
  name: string;
  reason: string;
  permissionOverwrites?: PermissionOverwriteInput[];
};

export type DiscordTextChannelPort = {
  id: string;
  send(input: {
    content: string;
    allowedMentions: { parse: [] };
  }): Promise<{ id: string }>;
  sendTyping(): Promise<void>;
  setPermissionOverwrites(
    overwrites: PermissionOverwriteInput[],
    reason: string,
  ): Promise<void>;
  editPermissionOverwrite(
    id: string,
    permissions: Partial<Record<PermissionName, boolean>>,
    reason: string,
  ): Promise<void>;
  permissionsForMember(userId: string): Promise<Set<PermissionName>>;
};

export type DiscordRolePort = {
  id: string;
  name: string;
};

export type DiscordMemberPort = {
  userId: string;
  addRole(roleId: string, reason: string): Promise<void>;
  removeRole(roleId: string, reason: string): Promise<void>;
};

export type DiscordGuildPort = {
  everyoneRoleId(): string;
  fetchTextChannel(id: string): Promise<DiscordTextChannelPort | null>;
  createTextChannel(input: CreateTextChannelInput): Promise<DiscordTextChannelPort>;
  fetchRole(id: string): Promise<DiscordRolePort | null>;
  createRole(input: {
    name: string;
    reason: string;
    mentionable: boolean;
  }): Promise<DiscordRolePort>;
  fetchMember(userId: string): Promise<DiscordMemberPort | null>;
};
