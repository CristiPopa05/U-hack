const functions = require('@google-cloud/functions-framework');
const { createClient } = require('@supabase/supabase-js');

const XT_GRID = [
    [0.001, 0.002, 0.002, 0.003, 0.003, 0.004, 0.005, 0.006, 0.007, 0.009, 0.011, 0.013, 0.016, 0.017, 0.017, 0.016],
    [0.002, 0.002, 0.003, 0.003, 0.004, 0.005, 0.006, 0.007, 0.008, 0.010, 0.012, 0.015, 0.018, 0.021, 0.020, 0.021],
    [0.002, 0.003, 0.003, 0.004, 0.004, 0.005, 0.006, 0.007, 0.009, 0.010, 0.013, 0.016, 0.021, 0.025, 0.027, 0.024],
    [0.002, 0.003, 0.003, 0.004, 0.005, 0.006, 0.007, 0.008, 0.009, 0.011, 0.014, 0.018, 0.024, 0.029, 0.039, 0.031],
    [0.003, 0.003, 0.004, 0.004, 0.005, 0.006, 0.007, 0.008, 0.010, 0.011, 0.014, 0.019, 0.027, 0.055, 0.091, 0.071],
    [0.004, 0.004, 0.004, 0.004, 0.005, 0.006, 0.007, 0.008, 0.010, 0.012, 0.014, 0.019, 0.033, 0.077, 0.142, 0.332],
    [0.004, 0.004, 0.004, 0.004, 0.005, 0.006, 0.007, 0.008, 0.009, 0.012, 0.014, 0.020, 0.034, 0.085, 0.134, 0.320],
    [0.004, 0.003, 0.004, 0.004, 0.005, 0.006, 0.007, 0.008, 0.010, 0.012, 0.014, 0.020, 0.028, 0.062, 0.095, 0.085],
    [0.002, 0.003, 0.004, 0.004, 0.005, 0.006, 0.007, 0.008, 0.009, 0.011, 0.014, 0.018, 0.025, 0.035, 0.042, 0.033],
    [0.002, 0.003, 0.003, 0.004, 0.005, 0.006, 0.007, 0.008, 0.009, 0.011, 0.013, 0.017, 0.021, 0.026, 0.026, 0.022],
    [0.002, 0.002, 0.003, 0.003, 0.004, 0.005, 0.006, 0.007, 0.009, 0.010, 0.013, 0.016, 0.019, 0.021, 0.020, 0.020],
    [0.001, 0.002, 0.002, 0.003, 0.004, 0.004, 0.005, 0.007, 0.008, 0.009, 0.012, 0.014, 0.016, 0.018, 0.017, 0.017]
];

// Funcția pentru analiza spațială
async function generateSpatialAnalysisHandler(req, res, supabase) {
    try {
        const match_id = req.body.match_id;

        // 0. MAI ÎNTÂI: Calculăm xT-ul pentru pasele acestui meci (dacă nu a fost calculat încă)
        let maiSuntPaseDeCalculat = true;
        while (maiSuntPaseDeCalculat) {
            const { data: uncalcPasses, error: uncalcErr } = await supabase
                .from('passes')
                .select('*')
                .eq('match_id', match_id)
                .or('xt.eq.0,xt.is.null')
                .limit(1000);

            if (uncalcErr) throw new Error("Eroare calcul xT: " + uncalcErr.message);

            if (!uncalcPasses || uncalcPasses.length === 0) {
                maiSuntPaseDeCalculat = false;
                break;
            }

            const updates = uncalcPasses.map((pass) => {
                const sX = Math.min(Math.max(Math.floor((pass.x_start / 100) * 16), 0), 15);
                const sY = Math.min(Math.max(Math.floor((pass.y_start / 100) * 12), 0), 11);
                const eX = Math.min(Math.max(Math.floor((pass.x_end / 100) * 16), 0), 15);
                const eY = Math.min(Math.max(Math.floor((pass.y_end / 100) * 12), 0), 11);

                const startValue = XT_GRID[sY][sX] || 0;
                const endValue = XT_GRID[eY][eX] || 0;
                let xtGain = parseFloat(Math.max(0, endValue - startValue).toFixed(6));

                if (xtGain === 0) {
                    xtGain = 0.00000001;
                }

                return { id: pass.id, match_id: pass.match_id, xt: xtGain };
            });

            const { error: upsErr } = await supabase
                .from('passes')
                .upsert(updates, { onConflict: 'id' });

            if (upsErr) throw new Error("Eroare upsert xT: " + upsErr.message);
        }

        // 1. Luăm jucătorii
        const { data: players, error: playersError } = await supabase
            .from('players')
            .select('id, team_id')
            .eq('match_id', match_id);

        if (playersError) throw new Error("Eroare la players: " + playersError.message);

        const playerToTeam = {};
        const teamIds = new Set();
        if (players) {
            players.forEach(p => {
                playerToTeam[p.id] = p.team_id;
                if (p.team_id) teamIds.add(p.team_id);
            });
        }

        // 2. Luăm TOATE pasele CALCULATE (paginat, ca să nu pierdem nimic)
        let allPasses = [];
        let offset = 0;
        const PAGE_SIZE = 1000;
        let hasMore = true;

        while (hasMore) {
            const { data: batch, error: passesError } = await supabase
                .from('passes')
                .select('id, player_id, x_start, y_start, x_end, y_end, xt')
                .eq('match_id', match_id)
                .gte('xt', 0)
                .order('id') // <-- FIXUL ESTE AICI: Ordonăm ca să nu sară rânduri la paginare
                .range(offset, offset + PAGE_SIZE - 1);

            if (passesError) throw new Error("Eroare la passes: " + passesError.message);

            if (!batch || batch.length === 0) {
                hasMore = false;
            } else {
                allPasses = allPasses.concat(batch);
                offset += PAGE_SIZE;
                if (batch.length < PAGE_SIZE) hasMore = false;
            }
        }

        const passes = allPasses;

        if (passes.length === 0) {
            return res.status(200).send({ success: true, message: "Nu sunt pase calculate pentru acest meci." });
        }

        // 3. Inițializăm matricile 16x12
        const createEmptyMatrix = () => Array(12).fill(0).map(() => Array(16).fill(0));

        const playerMatrices = {};
        const teamMatrices = {};

        if (players) {
            players.forEach(p => { playerMatrices[p.id] = createEmptyMatrix(); });
        }
        teamIds.forEach(tId => { teamMatrices[tId] = createEmptyMatrix(); });

        // 4. Umplem matricile — folosim valoarea xT ABSOLUTĂ a zonei de DESTINAȚIE
        //    Aceasta arată unde echipa/jucătorul livrează mingea, ponderat cu
        //    pericolul acelei zone (conform modelului Karun Singh).
        passes.forEach(pass => {
            const pId = pass.player_id;
            const tId = playerToTeam[pId];

            // Calculăm zona de destinație a pasei (end coordinates)
            const eX = Math.min(Math.max(Math.floor((pass.x_end / 100) * 16), 0), 15);
            const eY = Math.min(Math.max(Math.floor((pass.y_end / 100) * 12), 0), 11);

            // Valoarea xT absolută a zonei de destinație din grila Karun Singh
            const destXtValue = XT_GRID[eY][eX] || 0;

            // Ignorăm pase cu destinație de valoare 0
            if (destXtValue <= 0) return;

            if (pId) {
                if (!playerMatrices[pId]) playerMatrices[pId] = createEmptyMatrix();
                playerMatrices[pId][eY][eX] = parseFloat((playerMatrices[pId][eY][eX] + destXtValue).toFixed(6));
            }
            if (tId) {
                if (!teamMatrices[tId]) teamMatrices[tId] = createEmptyMatrix();
                teamMatrices[tId][eY][eX] = parseFloat((teamMatrices[tId][eY][eX] + destXtValue).toFixed(6));
            }
        });

        // 5. Pregătim Payload-ul de Upsert
        const spatialPayload = [];

        const processMatrix = (entity_id, type, matrix) => {
            let total_xt = 0;
            let max_val = -1;
            let max_zone_id = 0;

            for (let y = 0; y < 12; y++) {
                for (let x = 0; x < 16; x++) {
                    const val = matrix[y][x];
                    total_xt += val;
                    if (val > max_val) {
                        max_val = val;
                        max_zone_id = y * 16 + x;
                    }
                }
            }

            spatialPayload.push({
                match_id: match_id,
                entity_id: String(entity_id),
                type: type,
                xt_matrix: matrix,
                total_xt_value: total_xt,
                max_xt_zone_id: max_zone_id
            });

            return total_xt;
        };

        const playersToUpdate = [];

        for (const [pId, matrix] of Object.entries(playerMatrices)) {
            const total_xt = processMatrix(pId, 'PLAYER', matrix);
            playersToUpdate.push({ id: pId, xt: total_xt });
        }
        for (const [tId, matrix] of Object.entries(teamMatrices)) {
            processMatrix(tId, 'TEAM', matrix);
        }

        // 6. Salvăm în spatial_analysis
        const { error: upsertError } = await supabase
            .from('spatial_analysis')
            .upsert(spatialPayload, { onConflict: 'match_id,entity_id' });

        if (upsertError) throw new Error("Eroare upsert spatial: " + upsertError.message);

        // 7. Actualizăm xT-ul total în tabela players
        const updatePromises = playersToUpdate.map(p =>
            supabase.from('players').update({ xt: p.xt }).eq('id', p.id)
        );
        await Promise.all(updatePromises);

        return res.status(200).send({ success: true, message: `Spatial analysis creat cu succes pentru meciul ${match_id}!` });

    } catch (err) {
        return res.status(500).send({ error: err.message });
    }
}


// ENTRY POINT-UL PRINCIPAL
functions.http('calculateTxPerPas', async (req, res) => {
    // CORS — permite apeluri din orice origine (browser, frontend, etc.)
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');

    // Răspunde instant la preflight (OPTIONS) fără să facă nimic altceva
    if (req.method === 'OPTIONS') {
        return res.status(204).send('');
    }

    try {
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!supabaseUrl || !supabaseKey) {
            return res.status(500).send({ error: "Variabilele de mediu Supabase lipsesc" });
        }

        const supabase = createClient(supabaseUrl, supabaseKey);

        // Dacă e un request POST cu match_id, trecem la analiza spațială!
        if (req.method === 'POST' && req.body && req.body.match_id) {
            return await generateSpatialAnalysisHandler(req, res, supabase);
        }

        // Altfel, facem vechiul calcul de xT pentru pasele necalculate
        let totalPaseProcesate = 0;
        let maiSuntPase = true;

        while (maiSuntPase && totalPaseProcesate < 5000) {
            const { data: passes, error } = await supabase
                .from('passes')
                .select('*')
                .or('xt.eq.0,xt.is.null')
                .limit(1000);

            if (error) throw new Error(error.message);

            if (!passes || passes.length === 0) {
                maiSuntPase = false;
                break;
            }

            const updates = passes.map((pass) => {
                const sX = Math.min(Math.max(Math.floor((pass.x_start / 100) * 16), 0), 15);
                const sY = Math.min(Math.max(Math.floor((pass.y_start / 100) * 12), 0), 11);
                const eX = Math.min(Math.max(Math.floor((pass.x_end / 100) * 16), 0), 15);
                const eY = Math.min(Math.max(Math.floor((pass.y_end / 100) * 12), 0), 11);

                const startValue = XT_GRID[sY][sX] || 0;
                const endValue = XT_GRID[eY][eX] || 0;
                let xtGain = parseFloat(Math.max(0, endValue - startValue).toFixed(6));

                if (xtGain === 0) {
                    xtGain = 0.00000001;
                }

                return { id: pass.id, match_id: pass.match_id, xt: xtGain };
            });

            const { error: upsertError } = await supabase
                .from('passes')
                .upsert(updates, { onConflict: 'id' });

            if (upsertError) throw new Error(upsertError.message);

            totalPaseProcesate += updates.length;
        }

        if (totalPaseProcesate === 0) {
            return res.status(200).send({ success: true, message: "Nu s-au găsit pase noi cu valoarea 0!" });
        } else {
            return res.status(200).send({
                success: true,
                message: `Am calculat cu succes xT pentru ${totalPaseProcesate} pase. Daca mai sunt, apelează din nou!`
            });
        }

    } catch (err) {
        return res.status(500).send({ error: err.message });
    }
});