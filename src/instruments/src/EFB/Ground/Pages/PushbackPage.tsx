/* eslint-disable max-len */
import React, { useEffect, useRef, useState } from 'react';
import { useSimVar, useSplitSimVar } from '@instruments/common/simVars';
import {
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    ArrowUp,
    ChevronDoubleDown,
    ChevronDoubleUp,
    ChevronLeft,
    ChevronRight,
    PauseCircleFill,
    PlayCircleFill,
    TruckFlatbed,
    ZoomIn,
    ZoomOut,
} from 'react-bootstrap-icons';
import Slider from 'rc-slider';
import { toast } from 'react-toastify';
import { MathUtils } from '@shared/MathUtils';
import { IconPlane } from '@tabler/icons';
import { Coordinates } from 'msfs-geo';
import { computeDestinationPoint as geolibDestPoint } from 'geolib';
import { BingMap } from '../../UtilComponents/BingMap';
import { t } from '../../translation';

interface ScreenCoordinates {
    x: number;
    y: number;
}

interface TurningRadiusIndicatorProps {
    turningRadius: number;
}

function polarToCartesian(centerX, centerY, radius, angleInDegrees) {
    const angleInRadians = (angleInDegrees - 90) * Math.PI / 180.0;

    return {
        x: centerX + (radius * Math.cos(angleInRadians)),
        y: centerY + (radius * Math.sin(angleInRadians)),
    };
}

function describeArc(x, y, radius, startAngle, endAngle) {
    const start = polarToCartesian(x, y, radius, endAngle);
    const end = polarToCartesian(x, y, radius, startAngle);

    const arcSweep = endAngle - startAngle <= 180 ? '0' : '1';

    const d = [
        'M', start.x, start.y,
        'A', radius, radius, 0, arcSweep, 0, end.x, end.y,
    ].join(' ');

    return d;
}

const TurningRadiusIndicator = ({ turningRadius }: TurningRadiusIndicatorProps) => (
    <svg width={turningRadius * 2} height={turningRadius * 2} viewBox={`0 0 ${turningRadius * 2} ${turningRadius * 2}`}>
        <path d={describeArc(turningRadius, turningRadius, turningRadius, 0, 45 + 45 * (19 / turningRadius))} fill="none" stroke="white" strokeWidth="2" />
    </svg>
);

export const PushbackPage = () => {
    const [pushBackState, setPushBackState] = useSplitSimVar('PUSHBACK STATE', 'enum', 'K:TOGGLE_PUSHBACK', 'bool', 250);
    const [pushBackWait, setPushbackWait] = useSimVar('Pushback Wait', 'bool', 100);
    const [pushBackAttached] = useSimVar('Pushback Attached', 'bool', 100);
    const [pushbackAngle] = useSimVar('PUSHBACK ANGLE', 'Radians', 100);

    const [rudderPosition] = useSimVar('A:RUDDER POSITION', 'number', 50);
    const [elevatorPosition] = useSimVar('A:ELEVATOR POSITION', 'number', 50);

    const [planeGroundSpeed] = useSimVar('GROUND VELOCITY', 'Knots', 50);
    const [planeHeadingTrue] = useSimVar('PLANE HEADING DEGREES TRUE', 'degrees', 50);
    const [planeHeadingMagnetic] = useSimVar('PLANE HEADING DEGREES MAGNETIC', 'degrees', 50);
    const [planeLatitude] = useSimVar('A:PLANE LATITUDE', 'degrees latitude', 50);
    const [planeLongitude] = useSimVar('A:PLANE LONGITUDE', 'degrees longitude', 50);

    const [mapRange, setMapRange] = useState(0.2);

    const [actualLatLon, setActualLatLon] = useState({ lat: 0, long: 0 } as Coordinates);
    const [centerPlaneMode, setCenterPlaneMode] = useState(true);

    const [dragging, setDragging] = useState(false);
    const [mouseDown, setMouseDown] = useState(false);
    const [dragStartCoords, setDragStartCoords] = useState({ x: 0, y: 0 } as ScreenCoordinates);
    const [mouseCoords, setMouseCoords] = useState({ x: 0, y: 0 } as ScreenCoordinates);

    const [parkingBrakeEngaged, setParkingBrakeEngaged] = useSimVar('L:A32NX_PARK_BRAKE_LEVER_POS', 'Bool', 250);

    const [pushBackPaused, setPushBackPaused] = useState(false);
    const [lastTime, setLastTime] = useState(0);
    const [deltaTime, setDeltaTime] = useState(0);
    const [tugCommandedHeading, setTugCommandedHeading] = useState(0);
    const [tugCommandedHeadingFactor, setTugCommandedHeadingFactor] = useState(0);
    const [tugCommandedSpeedFactor, setTugCommandedSpeedFactor] = useState(0);
    const [tugCommandedSpeed, setTugCommandedSpeed] = useState(0);

    // required so these can be used inside the setInterval callback function
    const pushBackAttachedRef = useRef(pushBackAttached);
    pushBackAttachedRef.current = pushBackAttached;
    const pushbackPausedRef = useRef(pushBackPaused);
    pushbackPausedRef.current = pushBackPaused;
    const lastTimeRef = useRef(lastTime);
    lastTimeRef.current = lastTime;
    const deltaTimeRef = useRef(deltaTime);
    deltaTimeRef.current = deltaTime;
    const tugCommandedHeadingFactorRef = useRef(tugCommandedHeadingFactor);
    tugCommandedHeadingFactorRef.current = tugCommandedHeadingFactor;
    const tugCommandedSpeedFactorRef = useRef(tugCommandedSpeedFactor);
    tugCommandedSpeedFactorRef.current = tugCommandedSpeedFactor;

    // called once when loading and unloading
    useEffect(() => {
        setPushBackPaused(true);
        setTugCommandedSpeedFactor(0);
        setPushbackWait(1);
        // when unloading the page
        return (() => {
            if (pushBackAttachedRef.current) {
                setPushBackPaused(true);
                setTugCommandedSpeedFactor(0);
                setPushbackWait(1);
                toast.info('Pausing Pushback. Return to Pushback page to resume pushback.');
            }
        });
    }, []);

    const handleCallTug = () => {
        setPushBackState(!pushBackState);
        setPushbackWait(1);
    };

    const handlePause = () => {
        setPushBackPaused(!pushBackPaused);
    };

    const handleTugSpeed = (speed: number) => {
        setTugCommandedSpeedFactor(MathUtils.clamp(speed, -1, 1));
        if (speed) {
            setPushBackPaused(false);
        }
    };

    const handleTugDirection = (value: number) => {
        setTugCommandedHeadingFactor(MathUtils.clamp(value, -1, 1));
    };

    const calculateTurningRadius = (wheelBase: number, turnAngle: number) => {
        const tanDeg = Math.tan(turnAngle * Math.PI / 180);
        return wheelBase / tanDeg;
    };

    const computeOffset: (latLon: Coordinates, d: ScreenCoordinates) => Coordinates = (
        latLon: Coordinates, d: ScreenCoordinates,
    ) => {
        const someConstant = 900 / mapRange; // ((mapSize / 2) / mapRange)
        const distance = Math.hypot(d.x, d.y) / someConstant;
        const bearing = Math.atan2(d.y, d.x) * (180 / Math.PI) - 90 + planeHeadingTrue;
        const point = geolibDestPoint({ lat: latLon.lat, lon: latLon.long }, distance * 1852, bearing, 6371000);
        // console.log(`LatLon: ${latLon.lat} ${latLon.long} DeltaScreen: ${d.x} ${d.y} Distance: ${distance} Bearing: ${bearing} Point: ${point.latitude} ${point.longitude}`);
        return { lat: point.latitude, long: point.longitude };
    };

    // Update commanded heading from rudder input
    useEffect(() => {
        // create deadzone
        if (rudderPosition > -0.05 && rudderPosition < 0.05) {
            setTugCommandedHeadingFactor(0);
            return;
        }
        setTugCommandedHeadingFactor(rudderPosition);
    }, [rudderPosition]);

    // Update commanded speed from elevator input
    useEffect(() => {
        // create deadzone
        if (elevatorPosition > -0.05 && elevatorPosition < 0.05) {
            setTugCommandedSpeedFactor(0);
            return;
        }
        setPushBackPaused(false);
        setTugCommandedSpeedFactor(-elevatorPosition);
    }, [elevatorPosition]);

    const SHOW_DEBUG_INFO = false;
    const InternalTugHeadingDegrees = 0xffffffff / 360;

    const updater = () => {
        const startTime = Date.now();
        setDeltaTime(() => (startTime - lastTimeRef.current.valueOf()));
        setLastTime(() => startTime);

        const simOnGround = SimVar.GetSimVarValue('SIM ON GROUND', 'bool');
        const pushBackAttached = SimVar.GetSimVarValue('Pushback Attached', 'bool');

        if (pushBackAttached && simOnGround) {
            // If no speed is commanded stop the aircraft and return.
            if (pushbackPausedRef.current.valueOf() || tugCommandedSpeedFactorRef.current.valueOf() === 0) {
                SimVar.SetSimVarValue('K:KEY_TUG_SPEED', 'Number', 0);
                SimVar.SetSimVarValue('VELOCITY BODY Z', 'Number', 0);
                SimVar.SetSimVarValue('Pushback Wait', 'bool', true);
            } else {
                // compute heading and speed
                SimVar.SetSimVarValue('Pushback Wait', 'bool', false);
                const parkingBrakeEngaged = SimVar.GetSimVarValue('L:A32NX_PARK_BRAKE_LEVER_POS', 'Bool');
                const aircraftHeading = SimVar.GetSimVarValue('PLANE HEADING DEGREES TRUE', 'degrees');
                const computedTugHeading = (aircraftHeading - (50 * tugCommandedHeadingFactorRef.current.valueOf())) % 360;
                setTugCommandedHeading((() => computedTugHeading)); // debug
                const computedRotationVelocity = (tugCommandedSpeedFactorRef.current.valueOf() <= 0 ? -1 : 1) * tugCommandedHeadingFactorRef.current.valueOf() * (parkingBrakeEngaged ? 0.008 : 0.08);
                const convertedComputedHeading = (computedTugHeading * InternalTugHeadingDegrees) & 0xffffffff;
                const tugCommandedSpeed = tugCommandedSpeedFactorRef.current.valueOf() * (parkingBrakeEngaged ? 0.8 : 8);
                setTugCommandedSpeed(() => tugCommandedSpeed); // debug
                // Set tug heading
                SimVar.SetSimVarValue('K:KEY_TUG_HEADING', 'Number', convertedComputedHeading);
                SimVar.SetSimVarValue('ROTATION VELOCITY BODY X', 'Number', 0);
                SimVar.SetSimVarValue('ROTATION VELOCITY BODY Y', 'Number', computedRotationVelocity);
                SimVar.SetSimVarValue('ROTATION VELOCITY BODY Z', 'Number', 0);
                // Set tug speed
                SimVar.SetSimVarValue('K:KEY_TUG_SPEED', 'Number', tugCommandedSpeed);
                SimVar.SetSimVarValue('VELOCITY BODY X', 'Number', 0);
                SimVar.SetSimVarValue('VELOCITY BODY Y', 'Number', 0);
                SimVar.SetSimVarValue('VELOCITY BODY Z', 'Number', tugCommandedSpeed);
            }
        }

        if (SHOW_DEBUG_INFO) {
            const updateTime = Date.now() - startTime;
            console.log(`Pushback update took: ${updateTime}ms - Delta: ${deltaTimeRef.current}ms`);
        }
    };

    // Set up an update interval to ensure smooth movement independent of
    // Glass Cockpit refresh rate. This is required as refresh rate  is
    // 10x lower in external view which leads to jerky movements otherwise.
    const [updateInterval, setUpdateInterval] = useState(0);
    useEffect(() => {
        if (pushBackAttached && updateInterval === 0) {
            const interval = setInterval(updater, 50);
            // @ts-ignore
            setUpdateInterval(interval);
        } else if (!pushBackAttached) {
            clearInterval(updateInterval);
            setUpdateInterval(0);
        }
    }, [pushBackAttached]);

    // Update actual lat/lon when plane is moving
    useEffect(() => {
        if (centerPlaneMode) {
            setActualLatLon({ lat: planeLatitude, long: planeLongitude });
        }
    }, [centerPlaneMode, planeLatitude, planeLongitude]);

    useEffect(() => {
        if (dragging) {
            setCenterPlaneMode(false);
            const latLon: Coordinates = computeOffset(actualLatLon, {
                x: (mouseCoords.x - dragStartCoords.x),
                y: (mouseCoords.y - dragStartCoords.y),
            });
            setActualLatLon(latLon);
            setDragStartCoords(mouseCoords);
        }
    }, [dragging, mouseDown, mouseCoords]);

    const turningRadius = calculateTurningRadius(13, Math.abs(tugCommandedHeadingFactor * 90));

    const [showDebugInfo, setShowDebugInfo] = useState(false);
    function debugInformation() {
        return (
            <div className="flex absolute right-0 left-0 z-50 flex-grow justify-between mx-4 font-mono text-black bg-gray-100 border-gray-100">
                {/* @ts-ignore */}
                <div className="overflow-hidden text-black text-m">
                    deltaTime:
                    {' '}
                    {deltaTime}
                    <br />
                    pushBackPaused:
                    {' '}
                    {pushBackPaused ? 1 : 0}
                    <br />
                    pushBackWait:
                    {' '}
                    {pushBackWait}
                    <br />
                    pushBackAttached:
                    {' '}
                    {pushBackAttached}
                    <br />
                    pushBackState:
                    {' '}
                    {pushBackState}
                    <br />
                    tugAngle:
                    {' '}
                    {pushbackAngle.toFixed(3)}
                    {' ('}
                    {(pushbackAngle * (180 / Math.PI)).toFixed(3)}
                    {' °)'}
                </div>
                <div className="overflow-hidden text-black text-m">
                    acHeading:
                    {' '}
                    {planeHeadingTrue.toFixed(3)}
                    <br />
                    tCHeadingF:
                    {' '}
                    {tugCommandedHeadingFactor.toFixed(3)}
                    <br />
                    tCHeading :
                    {' '}
                    {tugCommandedHeading.toFixed(3)}
                    <br />
                    Rotation Velocity X:
                    {' '}
                    {SimVar.GetSimVarValue('ROTATION VELOCITY BODY Y', 'Number').toFixed(3)}
                    <br />
                    Rotation Velocity Y:
                    {' '}
                    {SimVar.GetSimVarValue('ROTATION VELOCITY BODY X', 'Number').toFixed(3)}
                    <br />
                    {' '}
                    Rotation Velocity Z:
                    {' '}
                    {SimVar.GetSimVarValue('ROTATION VELOCITY BODY Z', 'Number').toFixed(3)}
                </div>
                <div className="overflow-hidden text-black text-m">
                    acGroundSpeed:
                    {' '}
                    {planeGroundSpeed.toFixed(3)}
                    {'kts '}
                    {' ('}
                    {(planeGroundSpeed * 1.68781).toFixed(3)}
                    ft/s)
                    <br />
                    tCSpeedFactor:
                    {' '}
                    {tugCommandedSpeedFactor.toFixed(3)}
                    <br />
                    tCSpeed:
                    {' '}
                    {tugCommandedSpeed.toFixed(3)}
                    <br />
                    Velocity X:
                    {' '}
                    {SimVar.GetSimVarValue('VELOCITY BODY Y', 'Number').toFixed(3)}
                    <br />
                    Velocity Y:
                    {' '}
                    {SimVar.GetSimVarValue('VELOCITY BODY X', 'Number').toFixed(3)}
                    <br />
                    Velocity Z:
                    {' '}
                    {SimVar.GetSimVarValue('VELOCITY BODY Z', 'Number').toFixed(3)}
                </div>
            </div>
        );
    }

    return (
        <div className="flex relative flex-col space-y-4 h-content-section-reduced">
            <div
                className="overflow-hidden relative flex-grow h-[430px] rounded-lg border-2 border-theme-accent"
                onMouseDown={(e) => {
                    setMouseDown(true);
                    setDragStartCoords({ x: e.pageX, y: e.pageY });
                }}
                onMouseMove={(e) => {
                    if (mouseDown) {
                        setMouseCoords({ x: e.pageX, y: e.pageY });
                    }
                    if (mouseDown && !dragging && (Math.abs(e.pageX - dragStartCoords.x) > 3 || Math.abs(e.pageY - dragStartCoords.y) > 3)) {
                        setDragging(true);
                    }
                }}
                onMouseUp={() => {
                    setMouseDown(false);
                    if (dragging) {
                        setDragging(false);
                    }
                }}
            >
                {!process.env.VITE_BUILD && (
                    <BingMap
                        configFolder="/Pages/VCockpit/Instruments/MAP/"
                        centerLla={{ lat: actualLatLon.lat, long: actualLatLon.long }}
                        mapId="PUSHBACK_MAP"
                        range={mapRange}
                        rotation={-planeHeadingTrue}
                    />
                )}
                <div className="flex absolute inset-0 justify-center items-center">
                    <div className="absolute" style={{ transform: `rotate(-90deg) translateY(${turningRadius}px) scaleX(${tugCommandedSpeedFactor >= 0 ? 1 : -1}) scaleY(${tugCommandedHeadingFactor >= 0 ? 1 : -1}) translateY(${tugCommandedHeadingFactor >= 0 ? '0px' : `${turningRadius * 2}px`})` }}>
                        <TurningRadiusIndicator turningRadius={turningRadius} />
                    </div>

                    <IconPlane
                        className="text-theme-highlight transform -rotate-90 fill-current"
                        size={50}
                        strokeLinejoin="miter"
                    />
                </div>
                <div className="flex overflow-hidden absolute top-2 left-2 z-30 flex-col rounded-md cursor-pointer">
                    Heading (True):
                    {' '}
                    {planeHeadingTrue.toFixed(4)}
                    {' - '}
                    Heading (Magnetic):
                    {' '}
                    {planeHeadingMagnetic.toFixed(4)}
                </div>
                <div className="flex overflow-hidden absolute right-6 bottom-6 z-30 flex-col rounded-md cursor-pointer">
                    <button
                        type="button"
                        onClick={() => setCenterPlaneMode(!centerPlaneMode)}
                        className="p-2 hover:text-theme-body bg-theme-secondary hover:bg-theme-highlight transition duration-100 cursor-pointer"
                    >
                        <IconPlane
                            className={`text-white transform -rotate-90 ${centerPlaneMode && 'fill-current'}`}
                            size={40}
                            strokeLinejoin="round"
                        />
                    </button>
                    <button
                        type="button"
                        onClick={() => setMapRange(MathUtils.clamp(mapRange - 0.1, 0.1, 1.5))}
                        className="p-2 hover:text-theme-body bg-theme-secondary hover:bg-theme-highlight transition duration-100 cursor-pointer"
                    >
                        <ZoomIn size={40} />
                    </button>
                    <button
                        type="button"
                        onClick={() => setMapRange(MathUtils.clamp(mapRange + 0.1, 0.1, 1.5))}
                        className="p-2 hover:text-theme-body bg-theme-secondary hover:bg-theme-highlight transition duration-100 cursor-pointer"
                    >
                        <ZoomOut size={40} />
                    </button>
                </div>
            </div>
            {showDebugInfo && debugInformation()}
            <div className="flex flex-col p-6 space-y-4 rounded-lg border-2 border-theme-accent">
                <div className="flex flex-row space-x-4">
                    <div className="w-full">
                        <p className="text-center">{t('Pushback.CallTug')}</p>
                        <button
                            type="button"
                            onClick={handleCallTug}
                            className={`${pushBackAttached ? 'text-white bg-green-600 border-green-600' : 'bg-theme-highlight opacity-60 hover:opacity-100 text-theme-text hover:text-theme-secondary transition duration-200 disabled:bg-grey-600'}  border-2 border-theme-accent w-full h-20 rounded-md transition duration-100 flex items-center justify-center`}
                        >
                            <TruckFlatbed size={40} />
                        </button>
                    </div>
                    <div className="w-full">
                        <p className="text-center">
                            {pushBackPaused ? t('Pushback.Halt') : t('Pushback.Moving')}
                        </p>
                        <button
                            type="button"
                            onClick={handlePause}
                            className={`flex justify-center items-center w-full h-20 text-white bg-green-900 hover:bg-green-600 rounded-md transition duration-100 ${!pushBackAttached && 'opacity-30 pointer-events-none'}`}
                        >
                            {pushBackPaused ? (
                                <PlayCircleFill size={40} />
                            ) : (
                                <PauseCircleFill size={40} />
                            )}
                        </button>
                    </div>
                    <div className="w-full" />
                    <div className="w-full">
                        <p className="text-center">{t('Pushback.ParkingBrake.Title')}</p>
                        <button
                            type="button"
                            onClick={() => setParkingBrakeEngaged((old) => !old)}
                            className={`w-full h-20 rounded-md transition duration-100 flex items-center justify-center  ${parkingBrakeEngaged ? 'bg-white text-utility-red' : 'bg-utility-red text-white'}`}
                        >
                            <h1 className="font-bold text-current uppercase">{parkingBrakeEngaged ? t('Pushback.ParkingBrake.On') : t('Pushback.ParkingBrake.Off')}</h1>
                        </button>
                    </div>
                </div>

                <div className="flex flex-row space-x-4">
                    <div className="w-full">
                        <p className={`text-center ${!pushBackAttached && 'opacity-30 pointer-events-none'}`}>
                            { t('Pushback.Backward') }
                        </p>
                        <button
                            type="button"
                            className={`flex justify-center items-center w-full h-20 bg-theme-highlight hover:bg-theme-body rounded-md border-2 border-theme-highlight transition duration-100 hover:text-theme-highlight ${!pushBackAttached && 'opacity-30 pointer-events-none'}`}
                            onClick={() => handleTugSpeed(tugCommandedSpeedFactor - 0.1)}
                        >
                            <ArrowDown size={40} />
                        </button>
                    </div>

                    <div className="w-full">
                        <p className={`text-center ${!pushBackAttached && 'opacity-30 pointer-events-none'}`}>
                            {t('Pushback.Forward')}
                        </p>
                        <button
                            type="button"
                            className={`flex justify-center items-center w-full h-20 bg-theme-highlight hover:bg-theme-body rounded-md border-2 border-theme-highlight transition duration-100 hover:text-theme-highlight ${!pushBackAttached && 'opacity-30 pointer-events-none'}`}
                            onClick={() => handleTugSpeed(tugCommandedSpeedFactor + 0.1)}
                        >
                            <ArrowUp size={40} />
                        </button>
                    </div>

                    <div className="w-full">
                        <p className={`text-center ${!pushBackAttached && 'opacity-30 pointer-events-none'}`}>
                            {t('Pushback.Left')}
                        </p>
                        <button
                            type="button"
                            className={`flex justify-center items-center w-full h-20 bg-theme-highlight hover:bg-theme-body rounded-md border-2 border-theme-highlight transition duration-100 hover:text-theme-highlight ${!pushBackAttached && 'opacity-30 pointer-events-none'}`}
                            onClick={() => handleTugDirection(tugCommandedHeadingFactor - 0.1)}
                        >
                            <ArrowLeft size={40} />
                        </button>
                    </div>

                    <div className="w-full">
                        <p className={`text-center ${!pushBackAttached && 'opacity-30 pointer-events-none'}`}>
                            {t('Pushback.Right')}
                        </p>
                        <button
                            type="button"
                            className={`flex justify-center items-center w-full h-20 bg-theme-highlight hover:bg-theme-body rounded-md border-2 border-theme-highlight transition duration-100 hover:text-theme-highlight ${!pushBackAttached && 'opacity-30 pointer-events-none'}`}
                            onClick={() => handleTugDirection(tugCommandedHeadingFactor + 0.1)}
                        >
                            <ArrowRight size={40} />
                        </button>
                    </div>
                </div>

                <div>
                    <p className={`text-center ${!pushBackAttached && 'opacity-30 pointer-events-none'}`}>
                        {t('Pushback.TugDirection')}
                    </p>
                    <div className="flex flex-row items-center space-x-4">
                        <p className="font-bold text-unselected"><ChevronLeft /></p>
                        <Slider
                            className={`${!pushBackAttached && 'opacity-30 pointer-events-none'}`}
                            onChange={(value) => handleTugDirection(value)}
                            min={-1}
                            step={0.01}
                            max={1}
                            value={tugCommandedHeadingFactor}
                            startPoint={0}
                        />
                        <p className="font-bold text-unselected"><ChevronRight /></p>
                    </div>
                </div>

                <div>
                    <p className={`text-center ${!pushBackAttached && 'opacity-30 pointer-events-none'}`}>
                        {t('Pushback.TugSpeed')}
                    </p>
                    <div className="flex flex-row items-center space-x-4">
                        <p className="font-bold text-unselected"><ChevronDoubleDown /></p>
                        <Slider
                            className={`${!pushBackAttached && 'opacity-30 pointer-events-none'}`}
                            min={-1}
                            step={0.1}
                            max={1}
                            value={tugCommandedSpeedFactor}
                            onChange={(value) => handleTugSpeed(value)}
                            startPoint={0}
                        />
                        <p
                            className="font-bold text-unselected"
                            onDoubleClick={() => setShowDebugInfo((old) => !old)}
                        >
                            <ChevronDoubleUp />
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};
