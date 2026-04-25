import fs from 'fs';
import { uploadMatchData } from './src/lib/upload-service';

async function main() {
  try {
    const rawData = fs.readFileSync('../baza_de_date_json/meciul3.json', 'utf-8');
    const data = JSON.parse(rawData);
    await uploadMatchData(data);
    console.log("Success!");
  } catch (err) {
    console.error("Error:", err);
  }
}

main();
