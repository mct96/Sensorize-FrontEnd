import React from "react";

import { Chart, ChartPoint } from "chart.js";

import * as timeseries from "timeseries-analysis";

import { IChartInputType, IData } from "../Types/ChartInputType";

/* ────────────────────────────────────────────────────────────────────────── */

interface IProps {
    width : number|string  ;
    height: number|string  ;
    data  : IChartInputType;
}

interface IState extends IProps {
    max  : number;
    min  : number;
    stdev: number;
    mean : number;
}

export class RegressionChart extends React.Component<IProps, IState> {
    canvas   : React.RefObject<HTMLCanvasElement>;
    chartView: Chart         ;
    state    : IState        ;
    timerID  : NodeJS.Timeout;

    constructor(props: IProps) {
        super(props);

        this.canvas = React.createRef();

        this.state = {
            ...props,
            max  : undefined,
            min  : undefined,
            stdev: undefined,
            mean : undefined,
        };
    }

    componentDidMount = () => {
        const context = this.canvas.current.getContext("2d");
        this.chartView = new Chart(context, {
            data: {
                datasets: [{
                    label: "Samples",
                    data : [],
                    fill : false,
                    borderColor    : "black",
                    backgroundColor: "white",
                    showLine       : false,
                },{
                    label: "Forecast",
                    data : [],
                    fill : false,
                    borderColor    : "black",
                    backgroundColor: "red",
                    showLine       : true,
                },]
            },
            type: "line",
            options: {
                legend: {
                    position: "bottom"
                },
                scales: {
                    xAxes: [{
                        display: true,
                        type: "time",
                        time: {
                            unit: "millisecond",
                        },
                        ticks: {
                            callback: function(value, index, values) {
                                const nValues = values.length;
                                const tenPerc = Math.floor(nValues / 10);

                                if (index % tenPerc === 0 || nValues < 10)
                                    return value;

                                return null;
                            }
                        }
                    }],
                },
                layout: {
                    padding: {
                        bottom: 10
                    },
                },
                title: {
                    display: true,
                    text: (this.props.data.dataSource.label),
                },
                animation: {
                    duration: 0,
                }
            }
        });

        this.timerID = setInterval(()=>this.updateChartData(), 5000);
    }

    componentWillUnmount = () => {
        if (this.timerID)
            clearInterval(this.timerID);
    }

    parseToForecast = (data: IData[]) => {
        return data.map(dt => [dt.x, dt.y]);
    }

    parseFromForecast = (data: [Date, number][]) => {
        return data.map(dt => ({x: dt[0], y: dt[1]} as IData));
    }

    // Calcula a variação média de tempo.
    getDeltaTime(data: Date[]) {
        const delta: number[] = [];

        if (data.length <= 1)
            throw Error("Too small");

        for (let i = 1; i < data.length; ++i) {
            const diff = data[i].getTime() - data[i - 1].getTime();
            delta.push(diff);
        }

        const accumalator = delta.reduce((prev, curr) => prev + curr);
        return accumalator / delta.length;
    };

    // Faz a convolução dos dados pelos coeficientes.
    convolve(data: number[], coefficients: number[]) {
        const len = Math.min(data.length, coefficients.length);
        const dataLen = data.length;

        let output = 0;
        for (let i = 0; i < len; ++i) {
            output -= data[dataLen - i - 1] * coefficients[i];
        }

        return output;
    }

    forecast(inputData: IData[], degree: number, pointToForecast: number) {
        let data: [Date, number][] =
            inputData.map(v => [v.x as Date, v.y]);

        const dT = this.getDeltaTime(data.map(v=>v[0])); // Calcula a variação
                                                         //  média de tempo.

        for (let i = 0; i < pointToForecast; ++i) {
            const currentData = data; // Utiliza as amostras mais atuais.

            const t = new timeseries.main(currentData);

            const coeff = t.ARMaxEntropy({degree: degree});

            const output = this.convolve(currentData.map(data => data[1]), coeff);

            const lastDate = currentData[currentData.length - 1][0].getTime();

            const newPoint: [Date, number] = [new Date(lastDate + dT), output];

            data.push(newPoint);
        }

        return data;
    }

    /**
     * Realiza os calculos estatisticos. Veja:
     * - https://www.npmjs.com/package/timeseries-analysis
     * - http://paulbourke.net/miscellaneous/ar/
     */
    getStimatedValues = (data: IData[]) => {
        return new Promise<[Date, number][]>((resolve, reject) => {
            const parsedData = this.parseToForecast(data);
            const t = new timeseries.main(parsedData);

            // Calcula algumas métricas.
            this.setState({
                max  : t.max(),
                min  : t.min(),
                mean : t.mean(),
                stdev: t.stdev(),
            })

            // Reduz os ruídos dos dados.
            // t.smoother({period:10}).save('smoothed');
            // const bestSettings = t.regression_forecast_optimize();

            resolve(this.forecast(data, 10, 15));

            // Processa os dados e retorna o resultado.s
            /* resolve(t.sliding_regression_forecast({
                method: "ARLeastSquare",
                sample: data.length,
                degree: 20,
            }).output()); */
        });
    }

    updateChartData = () => {
        const sampleToAnalyse = 100; // Quantidades de dados para ser analisado.
        let dataAnalysed = this.props.data.data;

        const idx = dataAnalysed.findIndex((curr, i) => {
            const currDate = curr.x as Date;
            const prevDate = i-1 >= 0 ? dataAnalysed[i-1].x as Date : currDate;

            return currDate.getTime() < prevDate.getTime();
        });

        if (idx >= 0) dataAnalysed = dataAnalysed.slice(idx);

        /**
         * Plota os dados de uma data Source. Estes não incluem processamento
         * algum.
         */
        this.chartView.data.datasets[0].data =
            dataAnalysed
                .map(dt => dt as ChartPoint)
                .slice(-sampleToAnalyse);

        /**
         * Assim que o componente tiver dados sufiente, os calculos estatísticos
         * são realizados.
         */
        if (dataAnalysed.length > 5) {
            // console.log(this.forecast(dataAnalysed, 3, 10));
            this.getStimatedValues(dataAnalysed.slice(-sampleToAnalyse))
            .then(data => {
                const parsedData = this.parseFromForecast(data);
                this.chartView.data.datasets[1].data = parsedData;

                this.chartView.update();
            });
        }

    }

    render = () => {
        return (
        <div className="container mb-4 ml-2 mr-2">
            <div className="row justify-content-start">
            <div style={{width: "100%", height: this.props.height}}>
                <canvas
                    ref={this.canvas}
                    style={{
                        "width" : this.props.width,
                        "height": this.props.height,
                    }} />
                </div>
            </div>
            <div className="row">
                <table className="statistic-table">
                    <thead>
                        <th colSpan={2}>Metrics</th>
                    </thead>
                    <tbody>
                        <tr>
                            <td>Maximum</td>
                            <td>{this.state.max}</td>
                        </tr>
                        <tr>
                            <td>Minimum</td>
                            <td>{this.state.min}</td>
                        </tr>
                        <tr>
                            <td>Mean</td>
                            <td>{this.state.mean}</td>
                        </tr>
                        <tr>
                            <td>Standard Deviation</td>
                            <td>{this.state.stdev}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>);
    }
}