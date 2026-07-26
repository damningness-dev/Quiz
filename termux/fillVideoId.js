const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const FILE = path.join(__dirname, "..", "data", "questions.json");

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {

    const questions = JSON.parse(fs.readFileSync(FILE, "utf8"));

    let success = 0;
    let fail = 0;

    for (let i = 0; i < questions.length; i++) {

        const q = questions[i];

        // 이미 videoId가 있으면 건너뜀
        if (q.videoId && q.videoId.length === 11)
            continue;

        const keyword = q.title.replace(/-/g, " ");

        console.log(`\n[${i + 1}/${questions.length}] ${keyword}`);

        try {

            // 검색 결과 5개 가져오기
            const result = execSync(
                `yt-dlp "ytsearch5:${keyword}" --print "%(id)s|%(title)s"`,
                { encoding: "utf8" }
            );

            const videos = result
                .trim()
                .split("\n")
                .map(v => {
                    const idx = v.indexOf("|");
                    return {
                        id: v.substring(0, idx),
                        title: v.substring(idx + 1)
                    };
                });

            // 공식 영상 우선 선택
            let selected =
                videos.find(v =>
                    /official|official mv|official video|m\/v|뮤직비디오/i.test(v.title)
                );

            // 없으면 첫 번째 결과
            if (!selected)
                selected = videos[0];

            q.videoId = selected.id;

            console.log(`✔ ${selected.title}`);
            console.log(`→ ${selected.id}`);

            success++;

        } catch (e) {

            console.log("✖ 검색 실패");

            fail++;

        }

        // 매 곡마다 저장
        fs.writeFileSync(FILE, JSON.stringify(questions, null, 2));

        // 유튜브에 부담을 줄이기 위해 대기
        await sleep(1200);

    }

    console.log("\n=========================");
    console.log(`완료`);
    console.log(`성공 : ${success}`);
    console.log(`실패 : ${fail}`);
}

main();
