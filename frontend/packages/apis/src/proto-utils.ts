/**
 * Protocol Buffer type conversion utilities
 * 
 * Provides converters for common protobuf types (Timestamp, etc.) to JavaScript native types.
 * Use these utilities in API wrapper functions to provide clean, JavaScript-friendly interfaces.
 */

import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { create } from "@bufbuild/protobuf";

/**
 * Convert protobuf Timestamp to JavaScript Date
 * @param timestamp - Protobuf Timestamp object (optional)
 * @returns JavaScript Date object, or undefined if input is undefined
 */
export function protoTimestampToDate(timestamp: Timestamp | undefined): Date | undefined {
	if (!timestamp) {
		return undefined;
	}
	// Timestamp has seconds (bigint) and nanos (number)
	const milliseconds = Number(timestamp.seconds) * 1000 + Math.floor(timestamp.nanos / 1_000_000);
	return new Date(milliseconds);
}

/**
 * Convert JavaScript Date to protobuf Timestamp
 * @param date - JavaScript Date object (optional)
 * @returns Protobuf Timestamp object, or undefined if input is undefined
 */
export function dateToProtoTimestamp(date: Date | undefined): Timestamp | undefined {
	if (!date) {
		return undefined;
	}
	const milliseconds = date.getTime();
	const seconds = BigInt(Math.floor(milliseconds / 1000));
	const nanos = (milliseconds % 1000) * 1_000_000;

	return create(TimestampSchema, {
		seconds,
		nanos,
	});
}

