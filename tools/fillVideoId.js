const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const FILE = path.join(__dirname, "..", "data", "questions.json");

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {

    const questions = JSON.parse(fs.readFileSync(FILE, "utf8"));

    let success = 0;
    let fail = 0;

    for (let i = 0; i < questions.length; i++) {

        const q = questions[i];

        if (q.videoId && q.videoId.length === 11)
            continue;

        const keyword = `${q.title.replace("-", " ")} official mv`;

        console.log(`[${i + 1}/${questions.length}] ${keyword}`);

        try {

            const id = execSync(
                `yt-dlp "ytsearch1:${keyword}" --print id`,
                {
                    encoding: "utf8"
                }
            ).trim();

            q.videoId = id;

            success++;

            console.log(`   ✔ ${id}`);

        }
        catch {

            fail++;

            console.log("   ✖ 검색 실패");

        }

        fs.writeFileSync(FILE, JSON.stringify(questions, null, 2));

        await sleep(1500);

    }

    console.log("");
    console.log("========== 완료 ==========");
    console.log(`성공 : ${success}`);
    console.log(`실패 : ${fail}`);

}

main();
