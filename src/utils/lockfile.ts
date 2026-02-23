import { logger } from './logger';
import fs from 'fs';
import path from 'path';

const LOCK_FILE = path.resolve(process.cwd(), '.bot.lock');

/**
 * 指定PIDのプロセスが生きているか確認する
 */
function isProcessRunning(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

/**
 * 既存プロセスを停止し、終了を待つ
 */
function killExistingProcess(pid: number): void {
    logger.error(`🔄 既存の Bot プロセスを停止します (PID: ${pid})...`);
    try {
        process.kill(pid, 'SIGTERM');
    } catch {
        // 既に終了済みの場合は無視
        return;
    }

    // 最大5秒間、プロセスの終了を待つ
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
        if (!isProcessRunning(pid)) {
            logger.error(`✅ 既存プロセス (PID: ${pid}) を停止しました`);
            return;
        }
        // 50ms待つ (busy wait)
        const waitUntil = Date.now() + 50;
        while (Date.now() < waitUntil) { /* spin */ }
    }

    // タイムアウト: SIGKILLで強制終了
    logger.error(`⚠️  SIGTERM でプロセスが終了しなかったため、強制終了します (SIGKILL)`);
    try {
        process.kill(pid, 'SIGKILL');
    } catch {
        // ignore
    }
}

/**
 * ロックファイルを取得して二重起動を制御する。
 * 既に別プロセスが起動中の場合は、そのプロセスを停止してから起動する。
 *
 * @returns ロック解除用の関数
 */
export function acquireLock(): () => void {
    // 既存のロックファイルチェック
    if (fs.existsSync(LOCK_FILE)) {
        const content = fs.readFileSync(LOCK_FILE, 'utf-8').trim();
        const existingPid = parseInt(content, 10);

        if (!isNaN(existingPid) && existingPid !== process.pid && isProcessRunning(existingPid)) {
            // 既存プロセスを停止して再起動
            killExistingProcess(existingPid);
        } else if (!isNaN(existingPid) && !isProcessRunning(existingPid)) {
            logger.warn(`⚠️  古いロックファイルを検出 (PID: ${existingPid} は終了済み)。クリーンアップします。`);
        }

        // 古いロックファイルを削除
        try { fs.unlinkSync(LOCK_FILE); } catch { /* ignore */ }
    }

    // 新しいロックファイルを作成
    fs.writeFileSync(LOCK_FILE, String(process.pid), 'utf-8');
    logger.error(`🔒 ロック取得 (PID: ${process.pid})`);

    // クリーンアップ関数
    const releaseLock = () => {
        try {
            if (fs.existsSync(LOCK_FILE)) {
                const content = fs.readFileSync(LOCK_FILE, 'utf-8').trim();
                if (parseInt(content, 10) === process.pid) {
                    fs.unlinkSync(LOCK_FILE);
                    logger.error(`🔓 ロック解除 (PID: ${process.pid})`);
                }
            }
        } catch {
            // クリーンアップ中のエラーは無視
        }
    };

    // プロセス終了時に自動クリーンアップ
    process.on('exit', releaseLock);
    process.on('SIGINT', () => {
        releaseLock();
        process.exit(0);
    });
    process.on('SIGTERM', () => {
        releaseLock();
        process.exit(0);
    });
    process.on('uncaughtException', (err) => {
        logger.error('未処理の例外:', err);
        releaseLock();
        process.exit(1);
    });

    return releaseLock;
}
