/* eslint-disable no-undef */
// TODO: Deprecate, move boarding backend to WASM
function airplaneCanBoard() {
    const busDC2 = SimVar.GetSimVarValue("L:A32NX_ELEC_DC_2_BUS_IS_POWERED", "Bool");
    const busDCHot1 = SimVar.GetSimVarValue("L:A32NX_ELEC_DC_HOT_1_BUS_IS_POWERED", "Bool");
    const gs = SimVar.GetSimVarValue("GPS GROUND SPEED", "knots");
    const isOnGround = SimVar.GetSimVarValue("SIM ON GROUND", "Bool");
    const eng1Running = SimVar.GetSimVarValue("ENG COMBUSTION:1", "Bool");
    const eng2Running = SimVar.GetSimVarValue("ENG COMBUSTION:2", "Bool");

    return !(gs > 0.1 || eng1Running || eng2Running || !isOnGround || (!busDC2 && !busDCHot1));
}

function setDefaultWeights(simbriefPaxWeight, simbriefBagWeight) {
    const perPaxWeight = (simbriefPaxWeight === undefined) ? Math.round(NXUnits.kgToUser(84)) : simbriefPaxWeight;
    const perBagWeight = (simbriefBagWeight === undefined) ? Math.round(NXUnits.kgToUser(20)) : simbriefBagWeight;
    const conversionFactor = (getUserUnit() == "Kilograms") ? 0.4535934 : 1;
    SimVar.SetSimVarValue("L:A32NX_WB_PER_PAX_WEIGHT", "Number", parseInt(perPaxWeight));
    SimVar.SetSimVarValue("L:A32NX_WB_PER_BAG_WEIGHT", "Number", parseInt(perBagWeight));
    SimVar.SetSimVarValue("L:A32NX_EFB_UNIT_CONVERSION_FACTOR", "Number", conversionFactor);
}

class A32NX_Boarding {
    constructor() {
        this.boardingState = "finished";
        this.time = 0;
        const payloadConstruct = new A32NX_PayloadConstructor();
        this.paxStations = payloadConstruct.paxStations;
        this.cargoStations = payloadConstruct.cargoStations;
    }

    async init() {
        setDefaultWeights();
        this.loadPaxPayload();
        this.loadCargoZero();
        this.loadCargoPayload();
    }

    // Shuffle passengers within same station
    async shufflePax(station) {
        station.activeFlags.setFlags(station.desiredFlags.toNumber());
        await SimVar.SetSimVarValue(`L:${station.simVar}`, "string", station.desiredFlags.toString());
    }

    async fillPaxStation(station, paxTarget) {
        const paxDiff = Math.min(paxTarget, station.seats) - station.activeFlags.getTotalFilledSeats();

        if (paxDiff > 0) {
            const fillChoices = station.desiredFlags.getFilledSeatIds()
                .filter(seatIndex => !station.activeFlags.getFilledSeatIds().includes(seatIndex));
            station.activeFlags.fillSeats(Math.abs(paxDiff), fillChoices);
        } else if (paxDiff < 0) {
            const emptyChoices = station.desiredFlags.getEmptySeatIds()
                .filter(seatIndex => !station.activeFlags.getEmptySeatIds().includes(seatIndex));
            station.activeFlags.emptySeats(Math.abs(paxDiff), emptyChoices);
        } else {
            this.shufflePax(station);
        }

        await SimVar.SetSimVarValue(`L:${station.simVar}`, "string", station.activeFlags.toString());
    }

    async fillCargoStation(station, loadToFill) {
        station.load = loadToFill;
        await SimVar.SetSimVarValue(`L:${station.simVar}`, "Number", parseInt(loadToFill));
    }

    async setPax(numberOfPax) {
        let paxRemaining = parseInt(numberOfPax);

        async function fillStation(station, percent, paxToFill) {
            const pax = Math.min(Math.trunc(percent * paxToFill), station.seats);
            station.activeFlags.setFlags(pax);
            await SimVar.SetSimVarValue(`L:${station.simVar}_DESIRED`, "string", station.activeFlags.toString());
            paxRemaining -= pax;
        }

        await fillStation(paxStations['rows22_29'], .28 , numberOfPax);
        await fillStation(paxStations['rows14_21'], .28, numberOfPax);
        await fillStation(paxStations['rows7_13'], .25 , numberOfPax);
        await fillStation(paxStations['rows1_6'], 1 , paxRemaining);
        return;
    }

    loadPaxPayload() {
        const PAX_WEIGHT = SimVar.GetSimVarValue("L:A32NX_WB_PER_PAX_WEIGHT", "Number");
        return Promise.all(Object.values(this.paxStations).map(paxStation => {
            return SimVar.SetSimVarValue(`PAYLOAD STATION WEIGHT:${paxStation.stationIndex}`, getUserUnit(), paxStation.activeFlags.getTotalFilledSeats() * PAX_WEIGHT);
        }));
    }
    loadCargoPayload() {
        return Promise.all(Object.values(this.cargoStations).map(loadStation => {
            return SimVar.SetSimVarValue(`PAYLOAD STATION WEIGHT:${loadStation.stationIndex}`, getUserUnit(), loadStation.load);
        }));
    }

    loadCargoZero() {
        for (const station of Object.values(this.cargoStations)) {
            SimVar.SetSimVarValue(`PAYLOAD STATION WEIGHT:${station.stationIndex}`, "Kilograms", 0);
            SimVar.SetSimVarValue(`L:${station.simVar}_DESIRED`, "Number", 0);
            SimVar.SetSimVarValue(`L:${station.simVar}`, "Number", 0);
        }
    }

    async update(_deltaTime) {
        this.time += _deltaTime;

        const boardingStartedByUser = SimVar.GetSimVarValue("L:A32NX_BOARDING_STARTED_BY_USR", "Bool");
        const boardingRate = NXDataStore.get("CONFIG_BOARDING_RATE", 'REAL');

        if (!boardingStartedByUser) {
            return;
        }

        if ((!airplaneCanBoard() && boardingRate == 'REAL') || (!airplaneCanBoard() && boardingRate == 'FAST')) {
            return;
        }

        let currentPax = 0;
        let paxTarget = 0;
        let isAllPaxStationFilled = true;
        Object.values(this.paxStations).map((station) => {
            station.activeFlags.setFlags(SimVar.GetSimVarValue(`L:${station.simVar}`, 'Number'));
            const stationCurrentPax = station.activeFlags.getTotalFilledSeats();
            currentPax += stationCurrentPax;

            station.desiredFlags.setFlags(SimVar.GetSimVarValue(`L:${station.simVar}_DESIRED`, 'Number'));
            const stationCurrentPaxTarget = station.desiredFlags.getTotalFilledSeats();
            paxTarget += stationCurrentPaxTarget;

            if (stationCurrentPax !== stationCurrentPaxTarget) {
                isAllPaxStationFilled = false;
            }
        });

        const currentLoad = Object.values(this.cargoStations).map((station) => SimVar.GetSimVarValue(`L:${station.simVar}`, "Number")).reduce((acc, cur) => acc + cur);
        const loadTarget = Object.values(this.cargoStations).map((station) => SimVar.GetSimVarValue(`L:${station.simVar}_DESIRED`, "Number")).reduce((acc, cur) => acc + cur);

        let isAllCargoStationFilled = true;
        for (const _station of Object.values(this.cargoStations)) {
            const stationCurrentLoad = SimVar.GetSimVarValue(`L:${_station.simVar}`, "Number");
            const stationCurrentLoadTarget = SimVar.GetSimVarValue(`L:${_station.simVar}_DESIRED`, "Number");

            if (stationCurrentLoad !== stationCurrentLoadTarget) {
                isAllCargoStationFilled = false;
                break;
            }
        }

        // Sound Controllers
        if ((currentPax < paxTarget) && boardingStartedByUser == true) {
            await SimVar.SetSimVarValue("L:A32NX_SOUND_PAX_BOARDING", "Bool", true);
            this.isBoarding = true;
        } else {
            await SimVar.SetSimVarValue("L:A32NX_SOUND_PAX_BOARDING", "Bool", false);
        }

        await SimVar.SetSimVarValue("L:A32NX_SOUND_PAX_DEBOARDING", "Bool", currentPax > paxTarget && boardingStartedByUser == true);

        if ((currentPax == paxTarget) && this.isBoarding == true) {
            await SimVar.SetSimVarValue("L:A32NX_SOUND_BOARDING_COMPLETE", "Bool", true);
            this.isBoarding = false;
            return;
        }
        await SimVar.SetSimVarValue("L:A32NX_SOUND_BOARDING_COMPLETE", "Bool", false);

        await SimVar.SetSimVarValue("L:A32NX_SOUND_PAX_AMBIENCE", "Bool", currentPax > 0);

        if (currentPax === paxTarget && currentLoad === loadTarget && isAllPaxStationFilled && isAllCargoStationFilled) {
            // Finish boarding
            this.boardingState = "finished";

            await SimVar.SetSimVarValue("L:A32NX_BOARDING_STARTED_BY_USR", "Bool", false);

        } else if ((currentPax < paxTarget) || (currentLoad < loadTarget)) {
            this.boardingState = "boarding";
        } else if ((currentPax === paxTarget) && (currentLoad === loadTarget)) {
            this.boardingState = "finished";
        }

        if (boardingRate == 'INSTANT') {
            // Instant
            for (const paxStation of Object.values(this.paxStations)) {
                paxStation.desiredFlags.setFlags(SimVar.GetSimVarValue(`L:${paxStation.simVar}_DESIRED`, "Number"));
                const stationCurrentPaxTarget = paxStation.desiredFlags.getTotalFilledSeats();

                await this.fillPaxStation(paxStation, stationCurrentPaxTarget);
            }
            for (const loadStation of Object.values(this.cargoStations)) {
                const stationCurrentLoadTarget = SimVar.GetSimVarValue(`L:${loadStation.simVar}_DESIRED`, "Number");
                await this.fillCargoStation(loadStation, stationCurrentLoadTarget);
            }
            this.loadPaxPayload();
            this.loadCargoPayload();
            return;
        }

        let msDelay = 5000;

        if (boardingRate == 'FAST') {
            msDelay = 1000;
        }

        if (boardingRate == 'REAL') {
            msDelay = 5000;
        }

        if (this.time > msDelay) {
            this.time = 0;

            // Stations logic:
            for (const paxStation of Object.values(this.paxStations).reverse()) {
                paxStation.activeFlags.setFlags(SimVar.GetSimVarValue(`L:${paxStation.simVar}`, "Number"));
                const stationCurrentPax = paxStation.activeFlags.getTotalFilledSeats();

                paxStation.desiredFlags.setFlags(SimVar.GetSimVarValue(`L:${paxStation.simVar}_DESIRED`, "Number"));
                const stationCurrentPaxTarget = paxStation.desiredFlags.getTotalFilledSeats();

                if (stationCurrentPax < stationCurrentPaxTarget) {
                    this.fillPaxStation(paxStation, stationCurrentPax + 1);
                    break;
                } else if (stationCurrentPax > stationCurrentPaxTarget) {
                    this.fillPaxStation(paxStation, stationCurrentPax - 1);
                    break;
                } else {
                    // TODO: Handle shuffling passengers with time delay more gracefully
                    this.shufflePax(paxStation);
                    continue;
                }
            }

            for (const loadStation of Object.values(this.cargoStations)) {
                const stationCurrentLoad = SimVar.GetSimVarValue(`L:${loadStation.simVar}`, "Number");
                const stationCurrentLoadTarget = SimVar.GetSimVarValue(`L:${loadStation.simVar}_DESIRED`, "Number");

                const loadDelta = Math.abs(stationCurrentLoadTarget - stationCurrentLoad);
                if (stationCurrentLoad < stationCurrentLoadTarget) {
                    this.fillCargoStation(loadStation, stationCurrentLoad + Math.min(60, loadDelta));
                    break;
                } else if (stationCurrentLoad > stationCurrentLoadTarget) {
                    this.fillCargoStation(loadStation, stationCurrentLoad - Math.min(60, loadDelta));
                    break;
                } else {
                    continue;
                }
            }

            this.loadPaxPayload();
            this.loadCargoPayload();
        }
    }
}
