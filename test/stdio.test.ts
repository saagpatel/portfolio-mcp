import { spawn } from "node:child_process";
import { once } from "node:events";
import { describe, expect, it } from "vitest";

type Message = {
	id?: number;
	result?: {
		serverInfo?: { name?: string };
		tools?: Array<{ name: string }>;
	};
	error?: { code: number; message: string };
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

describe("stdio MCP transport", () => {
	it("initializes, lists tools, and closes the child", async () => {
		const child = spawn(process.execPath, ["dist/stdio.js"], {
			stdio: ["pipe", "pipe", "pipe"],
		});
		const messages: Message[] = [];
		const waiters: Array<{
			predicate: (message: Message) => boolean;
			resolve: (message: Message) => void;
			reject: (error: Error) => void;
			timer: ReturnType<typeof setTimeout>;
		}> = [];
		let pending = "";

		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			pending += chunk;
			for (;;) {
				const newline = pending.indexOf("\n");
				if (newline < 0) break;
				const line = pending.slice(0, newline);
				pending = pending.slice(newline + 1);
				if (!line) continue;
				let value: unknown;
				try {
					value = JSON.parse(line);
				} catch (error) {
					for (const waiter of waiters.splice(0)) {
						clearTimeout(waiter.timer);
						waiter.reject(
							error instanceof Error ? error : new Error(String(error)),
						);
					}
					return;
				}
				if (!isRecord(value)) continue;
				const message = value as Message;
				const waiterIndex = waiters.findIndex((waiter) =>
					waiter.predicate(message),
				);
				if (waiterIndex >= 0) {
					const [waiter] = waiters.splice(waiterIndex, 1);
					clearTimeout(waiter.timer);
					waiter?.resolve(message);
				} else {
					messages.push(message);
				}
			}
		});
		child.on("error", (error) => {
			for (const waiter of waiters.splice(0)) {
				clearTimeout(waiter.timer);
				waiter.reject(error);
			}
		});
		child.on("exit", (code) => {
			for (const waiter of waiters.splice(0)) {
				clearTimeout(waiter.timer);
				waiter.reject(new Error(`stdio child exited with code ${code}`));
			}
		});

		const waitFor = (predicate: (message: Message) => boolean) => {
			const existingIndex = messages.findIndex(predicate);
			if (existingIndex >= 0) {
				const [message] = messages.splice(existingIndex, 1);
				return Promise.resolve(message as Message);
			}
			return new Promise<Message>((resolve, reject) => {
				const timer = setTimeout(() => {
					const index = waiters.findIndex(
						(waiter) => waiter.resolve === resolve,
					);
					if (index >= 0) waiters.splice(index, 1);
					reject(new Error("Timed out waiting for stdio protocol response"));
				}, 10_000);
				waiters.push({ predicate, resolve, reject, timer });
			});
		};

		try {
			child.stdin.write(
				`${JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "initialize",
					params: {
						protocolVersion: "2025-06-18",
						capabilities: {},
						clientInfo: { name: "stdio-test", version: "1" },
					},
				})}\n`,
			);
			const initialized = await waitFor((message) => message.id === 1);
			expect(initialized.error).toBeUndefined();
			expect(initialized.result?.serverInfo?.name).toBe(
				"saagarpatel-portfolio",
			);

			child.stdin.write(
				`${JSON.stringify({
					jsonrpc: "2.0",
					method: "notifications/initialized",
				})}\n`,
			);
			child.stdin.write(
				`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`,
			);
			const listed = await waitFor((message) => message.id === 2);
			expect(listed.error).toBeUndefined();
			expect(listed.result?.tools?.length).toBe(8);
		} finally {
			child.stdin.end();
			if (child.exitCode === null) child.kill();
			await Promise.race([
				once(child, "exit"),
				new Promise((resolve) => setTimeout(resolve, 1_000)),
			]);
		}
	}, 15_000);
});
