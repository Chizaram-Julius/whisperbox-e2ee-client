export type UserProfile = {
  id: string;
  username: string;
  display_name: string;
  public_key: string;
  wrapped_private_key: string;
  pbkdf2_salt: string;
  created_at: string;
};

export type UserPublicInfo = {
  id: string;
  username: string;
  display_name: string;
};

export type ConversationSummary = {
  user_id: string;
  display_name: string;
  username: string;
  last_message_at: string | null;
};

export type EncryptedPayload = {
  ciphertext: string;
  iv: string;
  encryptedKey: string;
  encryptedKeyForSelf: string;
};

export type MessageResponse = {
  id: string;
  from_user_id: string;
  to_user_id: string;
  payload: EncryptedPayload;
  delivered: boolean;
  created_at: string;
};

export type AuthResponse = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: UserProfile;
};

export type TokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

export type RegisterRequest = {
  username: string;
  display_name: string;
  password: string;
  public_key: string;
  wrapped_private_key: string;
  pbkdf2_salt: string;
};

export type LoginRequest = {
  username: string;
  password: string;
};

export type SendMessageRequest = {
  to: string;
  payload: EncryptedPayload;
};

export type DecryptedMessage = MessageResponse & {
  plaintext: string;
  decryptError?: string;
  deliveryError?: string;
  pending?: boolean;
};

export type WebSocketFrame =
  | {
      event?: "message.receive";
      type: "message.receive";
      message?: MessageResponse;
      data?: MessageResponse;
      id?: string;
      from_user_id?: string;
      to_user_id?: string;
      payload?: EncryptedPayload;
      delivered?: boolean;
      created_at?: string;
    }
  | {
      event?: string;
      type: string;
      [key: string]: unknown;
    };
