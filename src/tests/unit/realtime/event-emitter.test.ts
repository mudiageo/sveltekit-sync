/**
 * EventEmitter Unit Tests
 * 
 * Tests for the EventEmitter base class used by realtime client and server.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from '$pkg/realtime/event-emitter.js';

describe('EventEmitter', () => {
	let emitter: EventEmitter;

	beforeEach(() => {
		emitter = new EventEmitter();
	});

	describe('on', () => {
		it('should register an event listener', () => {
			const handler = vi.fn();
			
			emitter.on('test', handler);
			emitter.emit('test', { message: 'hello' });

			expect(handler).toHaveBeenCalledWith({ message: 'hello' });
		});

		it('should return an unsubscribe function', () => {
			const handler = vi.fn();
			
			const unsubscribe = emitter.on('test', handler);
			
			expect(typeof unsubscribe).toBe('function');
		});

		it('should allow multiple listeners for the same event', () => {
			const handler1 = vi.fn();
			const handler2 = vi.fn();
			
			emitter.on('test', handler1);
			emitter.on('test', handler2);
			emitter.emit('test', 'data');

			expect(handler1).toHaveBeenCalledWith('data');
			expect(handler2).toHaveBeenCalledWith('data');
		});

		it('should handle different event types separately', () => {
			const handler1 = vi.fn();
			const handler2 = vi.fn();
			
			emitter.on('event1', handler1);
			emitter.on('event2', handler2);
			
			emitter.emit('event1', 'data1');

			expect(handler1).toHaveBeenCalledWith('data1');
			expect(handler2).not.toHaveBeenCalled();
		});
	});

	describe('off', () => {
		it('should remove an event listener', () => {
			const handler = vi.fn();
			
			emitter.on('test', handler);
			emitter.off('test', handler);
			emitter.emit('test', 'data');

			expect(handler).not.toHaveBeenCalled();
		});

		it('should work via unsubscribe function', () => {
			const handler = vi.fn();
			
			const unsubscribe = emitter.on('test', handler);
			unsubscribe();
			emitter.emit('test', 'data');

			expect(handler).not.toHaveBeenCalled();
		});

		it('should only remove the specific handler', () => {
			const handler1 = vi.fn();
			const handler2 = vi.fn();
			
			emitter.on('test', handler1);
			emitter.on('test', handler2);
			emitter.off('test', handler1);
			emitter.emit('test', 'data');

			expect(handler1).not.toHaveBeenCalled();
			expect(handler2).toHaveBeenCalledWith('data');
		});

		it('should handle removing non-existent handler gracefully', () => {
			const handler = vi.fn();
			
			expect(() => emitter.off('test', handler)).not.toThrow();
		});
	});

	describe('emit', () => {
		it('should emit event to all listeners', () => {
			const handler1 = vi.fn();
			const handler2 = vi.fn();
			
			emitter.on('test', handler1);
			emitter.on('test', handler2);
			emitter.emit('test', { data: 'value' });

			expect(handler1).toHaveBeenCalledWith({ data: 'value' });
			expect(handler2).toHaveBeenCalledWith({ data: 'value' });
		});

		it('should not throw if no listeners exist', () => {
			expect(() => emitter.emit('nonexistent', 'data')).not.toThrow();
		});

		it('should catch and log handler errors', () => {
			const errorHandler = vi.fn(() => {
				throw new Error('Handler error');
			});
			const successHandler = vi.fn();
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			
			emitter.on('test', errorHandler);
			emitter.on('test', successHandler);
			
			expect(() => emitter.emit('test', 'data')).not.toThrow();
			expect(successHandler).toHaveBeenCalled();
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining('Error in event handler for "test"'),
				expect.any(Error)
			);

			consoleSpy.mockRestore();
		});
	});

	describe('once', () => {
		it('should execute handler only once', () => {
			const handler = vi.fn();
			
			emitter.once('test', handler);
			emitter.emit('test', 'data1');
			emitter.emit('test', 'data2');

			expect(handler).toHaveBeenCalledTimes(1);
			expect(handler).toHaveBeenCalledWith('data1');
		});

		it('should return an unsubscribe function', () => {
			const handler = vi.fn();
			
			const unsubscribe = emitter.once('test', handler);
			unsubscribe();
			emitter.emit('test', 'data');

			expect(handler).not.toHaveBeenCalled();
		});

		it('should work with multiple once listeners', () => {
			const handler1 = vi.fn();
			const handler2 = vi.fn();
			
			emitter.once('test', handler1);
			emitter.once('test', handler2);
			emitter.emit('test', 'data');

			expect(handler1).toHaveBeenCalledTimes(1);
			expect(handler2).toHaveBeenCalledTimes(1);
		});
	});

	describe('removeAllListeners', () => {
		it('should remove all listeners for a specific event', () => {
			const handler1 = vi.fn();
			const handler2 = vi.fn();
			const handler3 = vi.fn();
			
			emitter.on('test1', handler1);
			emitter.on('test1', handler2);
			emitter.on('test2', handler3);
			
			emitter.removeAllListeners('test1');
			
			emitter.emit('test1', 'data');
			emitter.emit('test2', 'data');

			expect(handler1).not.toHaveBeenCalled();
			expect(handler2).not.toHaveBeenCalled();
			expect(handler3).toHaveBeenCalled();
		});

		it('should remove all listeners when no event specified', () => {
			const handler1 = vi.fn();
			const handler2 = vi.fn();
			
			emitter.on('test1', handler1);
			emitter.on('test2', handler2);
			
			emitter.removeAllListeners();
			
			emitter.emit('test1', 'data');
			emitter.emit('test2', 'data');

			expect(handler1).not.toHaveBeenCalled();
			expect(handler2).not.toHaveBeenCalled();
		});
	});

	describe('listenerCount', () => {
		it('should return the correct number of listeners', () => {
			expect(emitter.listenerCount('test')).toBe(0);
			
			emitter.on('test', vi.fn());
			expect(emitter.listenerCount('test')).toBe(1);
			
			emitter.on('test', vi.fn());
			expect(emitter.listenerCount('test')).toBe(2);
		});

		it('should return 0 for non-existent event', () => {
			expect(emitter.listenerCount('nonexistent')).toBe(0);
		});

		it('should update count after removing listeners', () => {
			const handler1 = vi.fn();
			const handler2 = vi.fn();
			
			emitter.on('test', handler1);
			emitter.on('test', handler2);
			expect(emitter.listenerCount('test')).toBe(2);
			
			emitter.off('test', handler1);
			expect(emitter.listenerCount('test')).toBe(1);
			
			emitter.removeAllListeners('test');
			expect(emitter.listenerCount('test')).toBe(0);
		});
	});
});
