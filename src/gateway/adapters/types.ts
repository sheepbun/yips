import type {
  GatewayIncomingMessage,
  GatewayMessageContext,
  GatewayMessageResponse,
  GatewayPlatform
} from "#gateway/types";

export interface GatewayAdapterOutboundRequest<TBody = unknown> {
  method: "POST" | "GET";
  endpoint: string;
  body?: TBody;
  headers?: Record<string, string>;
}

export interface GatewayAdapter<TInbound = unknown, TOutboundBody = unknown> {
  readonly platform: GatewayPlatform;
  parseInbound(payload: TInbound): GatewayIncomingMessage[];
  formatOutbound(
    context: GatewayMessageContext,
    response: GatewayMessageResponse
  ): GatewayAdapterOutboundRequest<TOutboundBody> | null;
}
