import { Context, Scenes } from 'telegraf';
import { NsType } from '@prisma/client';

export type OrderStep =
  | 'idle'
  | 'awaiting_domain'
  | 'awaiting_ns_type'
  | 'awaiting_nameservers'
  | 'awaiting_confirm';

export interface OrderSession {
  step: OrderStep;
  domain?: string;
  nsType?: NsType;
  nameservers?: string[];
}

export interface BotSession {
  order?: OrderSession;
}

/**
 * Context Telegraf dengan session kustom.
 */
export interface BotContext extends Context {
  session: BotSession;
}

export type { Scenes };
