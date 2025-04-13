# Package Structure Plan

## Overview

QMK requires that packets be of size 32. 
Node-hid adds a report id byte to the beginning of the packet.
We're going to leave room for that byte, even though qmk strips it out and uses the 33rd byte of the packet as part of our actual message,
we can't guarantee that behaviour on all systems/devices. So we're functionaaly working with 31 bytes, and we start writing at packet[1], where
packet[0] will be set by node-hid, and stripped by qmk. This means that from qmk's perspective, the final packet (the 33rd) will always be 0x00.

## Packet Structure

We'll be sending multi-packet strings of the snippets in snippets.json.

For now each time we trigger a send, we will be sending *every* snippet in the json file. Later we may work out a more complex strategy.

So here's my idea/plan for the communication and packet structure:

First packet:

This packet will be responsible for sending the command and some metadata about the whole transfer.

Byte 1: CommandByte

For now our only command is 0x01, which means "Update Snippets"
This is our only command because whenever we update snippets, qmk must erase and write an entire page of eeprom. So It's going to batch all the snippets into a collection and make 1 big write. This is the same thing that it will have to do for Adding/removing/editing snippets, but we still want a command snippet for future proofing.

Byte 2: The meaningful length of this packet in bytes
Always 5 for this first packet.

Byte 3: The number of packets we're sending
Calculated locally by this app

Byte 4: The number of snippers we're sending
Calculated locally by this app

Byte 5: checksum byte summing the bytes of this packet.

Second packet:

This packet will send the the first snippet and be the main packet type for the transfer.

Byte 1: A number 0x05,0x06,0x07 that signifies whether this is a trigger, snippet content, or an end-code.

Byte 2: A number that signifies whether this packet is the start of a sequence of packets, a continuation of a sequence, the end of a sequence, or a standalone 'single' packet i.e. a start and an end.

Byte 3: The length of the content of this packet in bytes.

Byte 4-30: The content of the packet.

Byte 31: checksum byte summing the bytes of this packet.

Final Packet:

Byte 1: 0xFF (End of Transfer)
Confirmation packet that tells the device that we're done sending packets, and will ask for a result (confirmation of number of packets/snippets sent).

## Protocol

The protocol should be simple? We calculate everything we need to make the transfer e.g. how many packets we're sending, how many snippets we're sending.
Then we send the first packet and wait for ack.
Then we start the main transfer.

On the other end, it should recieve the trigger phrase first (should always be a single packet because triggers are max 7 chars long).
Then it should recieve the snippet content in the form of Start->End, Start->Cont->End, or Single packets.
Then it should recieve a Single end-code packet.

All the way through it should do the checksum of each packet to make sure it's correct.
If it's not, it should send an error packet and stop doing any processing.
The receiver is responsible for building a collection of all the trigger, snippet and end-code combinations into a collection of snippet_t structs.

It will then handle the wear-leveling and writing to EEPROM.
