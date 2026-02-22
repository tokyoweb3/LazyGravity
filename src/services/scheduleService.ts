import * as cron from 'node-cron';
import { ScheduleRepository, ScheduleRecord } from '../database/scheduleRepository';

/**
 * ジョブ実行時のコールバック型
 * スケジュールレコードの情報を受け取り、実際のタスクを実行する
 */
export type JobCallback = (schedule: ScheduleRecord) => void;

/**
 * 定期実行ジョブの管理を担うサービスクラス。
 *
 * - Bot起動時にSQLiteに保存されたスケジュールを読み込み、node-cronに再登録する
 * - 新規スケジュールの追加・削除・一覧表示を行う
 * - 全スケジュールの一括停止（シャットダウン時など）を行う
 */
export class ScheduleService {
    private repo: ScheduleRepository;
    /** 実行中のcronタスクを管理するMap（スケジュールID → ScheduledTask） */
    private activeTasks: Map<number, cron.ScheduledTask> = new Map();

    constructor(repo: ScheduleRepository) {
        this.repo = repo;
    }

    /**
     * Bot起動時に呼ばれる。有効なスケジュールを全てDBから読み込み、node-cronに登録・再開する。
     *
     * @param jobCallback - 各ジョブ実行時に呼ばれるコールバック
     * @returns 復元されたスケジュール数
     */
    public restoreAll(jobCallback: JobCallback): number {
        const enabledSchedules = this.repo.findEnabled();

        for (const schedule of enabledSchedules) {
            this.registerCronTask(schedule, jobCallback);
        }

        return enabledSchedules.length;
    }

    /**
     * 新しいスケジュールを追加する。
     * Cron式のバリデーション → DB保存 → node-cron登録 の順に処理する。
     *
     * @param cronExpression - Cron式
     * @param prompt - 実行するプロンプト
     * @param workspacePath - 対象ワークスペースパス
     * @param jobCallback - ジョブ実行時のコールバック
     * @returns 作成されたスケジュールレコード
     * @throws 不正なCron式の場合
     */
    public addSchedule(
        cronExpression: string,
        prompt: string,
        workspacePath: string,
        jobCallback: JobCallback
    ): ScheduleRecord {
        // Cron式のバリデーション
        if (!cron.validate(cronExpression)) {
            throw new Error(`不正なCron式です: ${cronExpression}`);
        }

        // DBに保存
        const record = this.repo.create({
            cronExpression,
            prompt,
            workspacePath,
            enabled: true,
        });

        // node-cronに登録
        this.registerCronTask(record, jobCallback);

        return record;
    }

    /**
     * スケジュールを削除する。
     * 実行中のcronジョブを停止し、DBからも削除する。
     *
     * @param scheduleId - 削除対象のスケジュールID
     * @returns 削除に成功したかどうか
     */
    public removeSchedule(scheduleId: number): boolean {
        // 実行中のcronジョブを停止
        const task = this.activeTasks.get(scheduleId);
        if (task) {
            task.stop();
            this.activeTasks.delete(scheduleId);
        }

        // DBから削除
        return this.repo.delete(scheduleId);
    }

    /**
     * 全ての実行中cronジョブを停止する（Bot停止時に呼ぶ）
     */
    public stopAll(): void {
        for (const [id, task] of this.activeTasks) {
            task.stop();
        }
        this.activeTasks.clear();
    }

    /**
     * 全スケジュールの一覧を取得する
     */
    public listSchedules(): ScheduleRecord[] {
        return this.repo.findAll();
    }

    /**
     * node-cronにタスクを登録する内部メソッド
     */
    private registerCronTask(schedule: ScheduleRecord, jobCallback: JobCallback): void {
        const task = cron.schedule(
            schedule.cronExpression,
            () => {
                jobCallback(schedule);
            }
        );

        this.activeTasks.set(schedule.id, task);
    }
}
