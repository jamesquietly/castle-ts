import Ably from 'ably';

export const SUBSCRIBE = 'SUBSCRIBE' as Ably.ChannelMode;
export const PUBLISH = 'PUBLISH' as Ably.ChannelMode;
export const OBJECT_SUBSCRIBE = 'OBJECT_SUBSCRIBE' as Ably.ChannelMode;
export const OBJECT_PUBLISH = 'OBJECT_PUBLISH' as Ably.ChannelMode;
export const PRESENCE = 'PRESENCE' as Ably.ChannelMode;
export const PRESENCE_SUBSCRIBE = 'PRESENCE_SUBSCRIBE' as Ably.ChannelMode;

let client: Ably.Realtime | null = null;

export const initializeAbly = (key: string, clientId: string) => {
    if (!client) {
        client = new Ably.Realtime({ key, clientId });
    }
    return client;
};

export const getChannel = (channelName: string) => {
    if (!client) {
        throw new Error("Ably client not initialized. Call initializeAbly first.");
    }

    // Using the requested constants for channel options
    const channel = client.channels.get(channelName, {
        modes: [SUBSCRIBE, PUBLISH, OBJECT_SUBSCRIBE, OBJECT_PUBLISH, PRESENCE, PRESENCE_SUBSCRIBE]
    });

    return channel;
};
