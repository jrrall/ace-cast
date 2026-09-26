// Layered revision: 48 kHz / 24-bit stereo WAVs, all original synthesis.
// Evaluate the whole file in SuperCollider. Originals remain in public/audio.
(
var source = thisProcess.nowExecutingPath;
var output, tactile, air, mallet, warmth, space, defs, note, render;
if(source.isNil) { Error("Run this saved file using thisProcess.interpreter.executeFile(path).").throw };
output = PathName(source).pathOnly +/+ "../../public/audio/layered/";

// Three physical layers: rubbery body, woody resonances, a soft contact tick.
tactile = SynthDef(\aceTactileV2, { |freq = 660, amp = 0.32, decay = 0.17, pan = 0|
    var env, pitch, body, wood, touch;
    RandSeed.ir(1, 174);
    env = EnvGen.ar(Env.perc(0.002, decay, 1, -6), doneAction: 2);
    pitch = XLine.ar(freq * 1.5, freq, 0.023);
    body = SinOsc.ar(pitch, SinOsc.ar(pitch * 2) * env * 0.7) * env;
    wood = Mix(SinOsc.ar(freq * [0.49, 1.47, 2.53], 0, [0.20, 0.10, 0.035]))
        * EnvGen.ar(Env.perc(0.001, 0.065, 1, -5));
    touch = BPF.ar(PinkNoise.ar, 2100, 0.8)
        * EnvGen.ar(Env.perc(0.001, 0.023, 0.28, -4));
    Out.ar(16, Pan2.ar(LeakDC.ar(body + wood + touch) * amp, pan));
});

// A moving textured stroke: broad silk plus a narrow papery edge.
air = SynthDef(\aceAirV2, { |from = 1200, to = 4200, amp = 0.32, decay = 0.12, pan = 0|
    var env, sweep, silk, edge;
    RandSeed.ir(1, 319);
    env = EnvGen.ar(Env.perc(0.009, decay, 1, -3), doneAction: 2);
    sweep = XLine.ar(from, to, decay);
    silk = BPF.ar(PinkNoise.ar, sweep, 0.85) * 1.4;
    edge = BPF.ar(WhiteNoise.ar, sweep * 1.6, 0.3) * 0.22;
    Out.ar(16, Pan2.ar((silk + edge) * env * amp, Line.kr(pan, pan.neg, decay)));
});

// Struck glass/wood hybrid. Partials decay separately instead of a plain beep.
mallet = SynthDef(\aceMalletV2, { |freq = 660, amp = 0.26, decay = 0.30, pan = 0|
    var env, fundamental, partials, strike;
    RandSeed.ir(1, 427);
    env = EnvGen.ar(Env.perc(0.003, decay, 1, -5), doneAction: 2);
    fundamental = SinOsc.ar(freq, SinOsc.ar(freq * 2) * env.squared * 0.45) * env;
    partials = Mix(SinOsc.ar(freq * [2.006, 3.012, 4.17], 0, [0.17, 0.07, 0.025])
        * EnvGen.ar(Env.perc(0.001, decay * 0.38, 1, -7)));
    strike = BPF.ar(PinkNoise.ar, 3200, 0.65)
        * EnvGen.ar(Env.perc(0.001, 0.018, 0.16, -5));
    Out.ar(16, Pan2.ar(LeakDC.ar(fundamental + partials + strike) * amp, pan));
});

// A quiet warm bed gives milestones weight without a long musical sting.
warmth = SynthDef(\aceWarmthV2, { |freq = 293.66, amp = 0.15, decay = 0.34|
    var env, body, harmonic;
    env = EnvGen.ar(Env.perc(0.007, decay, 1, -4), doneAction: 2);
    body = SinOsc.ar(freq * [0.998, 1.002]) * 0.65;
    harmonic = SinOsc.ar(freq * 2 * [1.001, 0.999]) * 0.17;
    Out.ar(16, (body + harmonic) * env * amp);
});

// Dry, immediate center with quiet stereo early reflections and a short tail.
// Final fade guarantees clean endings; stereo delays also survive mono mixdown.
space = SynthDef(\aceSpaceV2, { |duration = 0.5|
    var dry, reflections, diffuse, fade, mix;
    dry = In.ar(16, 2);
    reflections = DelayC.ar(dry.reverse, 0.08, [0.017, 0.027]) * 0.16
        + DelayC.ar(dry, 0.08, [0.041, 0.053]) * 0.07;
    diffuse = AllpassC.ar(LPF.ar(dry, 5200), 0.08, [0.037, 0.049], 0.12) * 0.06;
    fade = EnvGen.ar(Env.linen(0.001, duration - 0.026, 0.025), doneAction: 2);
    mix = LeakDC.ar(LPF.ar(dry + reflections + diffuse, 10500));
    Out.ar(0, (mix * 1.15).tanh * 0.86 * fade);
});

defs = [tactile, air, mallet, warmth, space].collect { |def| [\d_recv, def.asBytes] };
note = { |time, synth, args| [time, [\s_new, synth, -1, 0, 0] ++ args] };
render = { |name, duration, events|
    var score = Score([[0] ++ defs,
        [0.001, [\s_new, \aceSpaceV2, 2000, 1, 0, \duration, duration - 0.001]]]
        ++ events ++ [[duration, [\c_set, 0, 0]]]);
    score.sort;
    score.recordNRT(outputFilePath: output ++ name ++ ".wav",
        sampleRate: 48000, headerFormat: "WAV", sampleFormat: "int24",
        options: ServerOptions.new.numOutputBusChannels_(2),
        action: { |exitCode|
            if(exitCode == 0) { ("EXPORTED layered/" ++ name ++ ".wav (24-bit stereo)").postln }
            { ("Export failed: " ++ name ++ " code " ++ exitCode).warn };
        }
    );
};

render.("card-pop", 0.36, [
    note.(0.005, \aceTactileV2, [\freq, 660, \amp, 0.39]),
    note.(0.005, \aceWarmthV2, [\freq, 165, \amp, 0.10, \decay, 0.09]),
    note.(0.058, \aceMalletV2, [\freq, 990, \amp, 0.15, \decay, 0.18, \pan, 0.14])
]);
render.("card-swap", 0.38, [
    note.(0.005, \aceAirV2, [\from, 3100, \to, 800, \amp, 0.48, \decay, 0.09, \pan, -0.35]),
    note.(0.085, \aceAirV2, [\from, 1000, \to, 3800, \amp, 0.42, \decay, 0.10, \pan, 0.35]),
    note.(0.145, \aceTactileV2, [\freq, 740, \amp, 0.27, \decay, 0.12])
]);
render.("answer-reveal", 0.46, [
    note.(0.005, \aceAirV2, [\from, 1000, \to, 4800, \amp, 0.42, \decay, 0.10, \pan, -0.28]),
    note.(0.035, \aceTactileV2, [\freq, 440, \amp, 0.15, \decay, 0.08]),
    note.(0.060, \aceMalletV2, [\freq, 1174.66, \amp, 0.28, \decay, 0.27, \pan, 0.12]),
    note.(0.093, \aceMalletV2, [\freq, 1760, \amp, 0.065, \decay, 0.16, \pan, -0.18])
]);
render.("new-round", 0.55, [
    note.(0.005, \aceWarmthV2, [\amp, 0.13, \decay, 0.28]),
    note.(0.005, \aceMalletV2, [\freq, 587.33, \amp, 0.28, \decay, 0.24, \pan, -0.12]),
    note.(0.115, \aceMalletV2, [\freq, 880, \amp, 0.28, \decay, 0.29, \pan, 0.12]),
    note.(0.120, \aceAirV2, [\from, 2500, \to, 1500, \amp, 0.10, \decay, 0.18])
]);
render.("round-win", 0.69, [
    note.(0.005, \aceWarmthV2, [\amp, 0.14, \decay, 0.40]),
    note.(0.005, \aceMalletV2, [\freq, 587.33, \amp, 0.29, \decay, 0.24, \pan, -0.18]),
    note.(0.085, \aceMalletV2, [\freq, 739.99, \amp, 0.29, \decay, 0.26]),
    note.(0.170, \aceMalletV2, [\freq, 880, \amp, 0.31, \decay, 0.35, \pan, 0.18]),
    note.(0.180, \aceAirV2, [\from, 3600, \to, 1800, \amp, 0.12, \decay, 0.15]),
    note.(0.215, \aceMalletV2, [\freq, 1760, \amp, 0.06, \decay, 0.21, \pan, -0.25])
]);
render.("game-win", 0.98, [
    note.(0.005, \aceWarmthV2, [\amp, 0.16, \decay, 0.30]),
    note.(0.005, \aceTactileV2, [\freq, 293.66, \amp, 0.16, \decay, 0.12]),
    note.(0.005, \aceMalletV2, [\freq, 587.33, \amp, 0.28, \decay, 0.23, \pan, -0.20]),
    note.(0.095, \aceMalletV2, [\freq, 739.99, \amp, 0.28, \decay, 0.23, \pan, -0.08]),
    note.(0.185, \aceMalletV2, [\freq, 880, \amp, 0.29, \decay, 0.25, \pan, 0.08]),
    note.(0.285, \aceMalletV2, [\freq, 1174.66, \amp, 0.28, \decay, 0.45, \pan, 0.20]),
    note.(0.285, \aceWarmthV2, [\amp, 0.17, \decay, 0.48]),
    note.(0.285, \aceMalletV2, [\freq, 739.99, \amp, 0.10, \decay, 0.39, \pan, -0.25]),
    note.(0.285, \aceMalletV2, [\freq, 880, \amp, 0.10, \decay, 0.39, \pan, 0.25]),
    note.(0.300, \aceAirV2, [\from, 4200, \to, 1400, \amp, 0.15, \decay, 0.23]),
    note.(0.370, \aceMalletV2, [\freq, 2349.32, \amp, 0.055, \decay, 0.23, \pan, -0.28])
]);
)
