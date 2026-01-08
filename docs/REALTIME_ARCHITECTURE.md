# Realtime Presence System - Internal Architecture

## Event Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Client A (Browser)                           │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐         │
│  │PresenceStore │───▶│ SyncChannel  │───▶│RealtimeClient│         │
│  └──────────────┘    └──────────────┘    └──────┬───────┘         │
│         │                    │                    │                  │
│         │ updateCursor()     │ track()            │ send(POST)       │
│         └────────────────────┴────────────────────┘                  │
│                                                    │                  │
│                                         SSE ◀──────┘ on()            │
└─────────────────────────────────────────────────────────────────────┘
                                                    │
                                           ┌────────▼────────┐
                                           │  Network Layer  │
                                           │  (HTTP/SSE)     │
                                           └────────┬────────┘
                                                    │
┌─────────────────────────────────────────────────▼─────────────────┐
│                            Server                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │            ServerSyncEngine.createRealtimeHandlers()      │    │
│  │                                                            │    │
│  │  GET /api/sync/realtime ──▶ RealtimeServer.createConnection() │
│  │                              (SSE stream starts)            │    │
│  │                                                            │    │
│  │  POST /api/sync/realtime ─▶ RealtimeServer.handleClientMessage()│
│  │                              │                             │    │
│  │                              ├─▶ presence:join             │    │
│  │                              ├─▶ presence:update           │    │
│  │                              ├─▶ presence:leave            │    │
│  │                              ├─▶ ephemeral                 │    │
│  │                              └─▶ channel:join/leave        │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                      │                             │
│                         ┌────────────▼─────────────┐              │
│                         │    RealtimeServer        │              │
│                         │  ┌─────────────────────┐ │              │
│                         │  │  EphemeralStore     │ │              │
│                         │  │  (Presence Data)    │ │              │
│                         │  │  TTL: 60s default   │ │              │
│                         │  └─────────────────────┘ │              │
│                         │                           │              │
│                         │  ┌─────────────────────┐ │              │
│                         │  │  Channel            │ │              │
│                         │  │  Subscriptions      │ │              │
│                         │  └─────────────────────┘ │              │
│                         │                           │              │
│                         │  ┌─────────────────────┐ │              │
│                         │  │  Active             │ │              │
│                         │  │  Connections        │ │              │
│                         │  └─────────────────────┘ │              │
│                         └───────────┬───────────────┘              │
│                                     │                              │
│                         Broadcast via SSE                          │
│                                     │                              │
└─────────────────────────────────────┼──────────────────────────────┘
                                      │
                     ┌────────────────┴────────────────┐
                     │                                  │
        ┌────────────▼──────────┐        ┌────────────▼──────────┐
        │   Client A (SSE)       │        │   Client B (SSE)       │
        │   presence:update      │        │   presence:update      │
        │   presence:join        │        │   presence:join        │
        │   presence:leave       │        │   presence:leave       │
        │   ephemeral            │        │   ephemeral            │
        └────────────────────────┘        └────────────────────────┘
```

## Summary

This document provides architectural insight into the realtime presence system, including event flows, component responsibilities, and opportunities for improvement. See content/docs/presence-awareness.md for user-facing documentation.
