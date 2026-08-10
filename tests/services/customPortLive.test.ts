import * as http from 'http';
import { getCdpCandidatePorts } from '../../src/utils/cdpPorts';
import { checkPort } from '../../src/services/antigravityLauncher';

describe('Custom CDP Port Live Integration', () => {
    let server: http.Server;
    const TEST_PORT = 9777;

    afterEach((done) => {
        if (server && server.listening) {
            server.close(done);
        } else {
            done();
        }
    });

    it('resolves env override and connects to live mock CDP listener on port 9777', async () => {
        process.env.CDP_PORT = '9777';
        process.env.ANTIGRAVITY_ACCOUNTS = 'work:9888';

        // 1. Verify environment resolution
        const candidatePorts = getCdpCandidatePorts();
        expect(candidatePorts).toContain(9777);
        expect(candidatePorts).toContain(9888);

        // 2. Start mock CDP server on port 9777
        server = http.createServer((req, res) => {
            if (req.url === '/json/list' || req.url === '/json/version') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify([{ title: 'Antigravity IDE', url: 'devtools://' }]));
                return;
            }
            res.writeHead(404);
            res.end();
        });

        await new Promise<void>((resolve) => server.listen(TEST_PORT, '127.0.0.1', () => resolve()));

        // 3. Probe port using launcher checkPort()
        const isAlive = await checkPort(TEST_PORT);
        expect(isAlive).toBe(true);
    });
});
