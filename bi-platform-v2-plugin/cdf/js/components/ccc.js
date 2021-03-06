var ChartComponent =  UnmanagedComponent.extend({
    exportChart: function(outputType, overrides) {
        var me = this;
        
        var buildUrlParameters = function(overrides) {
            overrides = overrides || {};

            var urlParams = {};

            // Pass the parameters defined in this component to the used data source.
            var paramDefsArray = me.parameters;
            if(paramDefsArray && paramDefsArray.length) {
                var paramDefs = $.extend({}, Dashboards.propertiesArrayToObject(paramDefsArray), overrides);
                for(var name in paramDefs) {
                    if(paramDefs.hasOwnProperty(name)) {
                        // Works with eval ...
                        var value = Dashboards.getParameterValue(paramDefs[name]);
                        if($.isArray(value) && value.length == 1 && ('' + value[0]).indexOf(';') >= 0) {
                            // Special case where single element will wrongly be treated as a parseable array by cda
                            value = doCsvQuoting(value[0],';');
                        }
                        //else Will not be correctly handled for functions that return arrays

                        if(typeof value == 'function') { value = value(); }

                        urlParams['param' + name] = value;
                    }
                }
            }

            // Check debug level and pass as parameter
            var level = me.dashboard.debug;
            if(level > 1) {
                urlParams.paramdebug = true;
                urlParams.paramdebugLevel = level;
            }

            var scriptName =  me.name.replace(/render_/, '');

            urlParams.script = ("/"+ 
                Dashboards.context.solution + "/" + 
                Dashboards.context.path     + "/" + 
                
                /* Dashboards.context.file.split('.')[0] + "_" + */ 
                scriptName + ".js") // TODO: This prevents deprecating the generation of 2 file names in CDE/CGG

                .replace(/\/+/g, '/');

            urlParams.attachmentName = scriptName;

            return urlParams;
        };

        var urlParams = buildUrlParameters(overrides);
        urlParams.outputType = outputType || 'png';
        
        var $exportIFrame = $('#cccExportIFrame');
        if(!$exportIFrame.length) {
            $exportIFrame = $('<iframe id="cccExportIFrame" style="display:none">');
            $exportIFrame[0].src = "../cgg/draw?" + $.param(urlParams);
            $exportIFrame.appendTo($('body')); 
        } else {
            $exportIFrame[0].src = "../cgg/draw?" + $.param(urlParams);
        }
    },

    renderChart: function() {
      var cd = this.chartDefinition;
      if(cd.dataAccessId || cd.query || cd.endpoint /*cpk*/) {
        this.triggerQuery(this.chartDefinition,_.bind(this.render, this));
      } else if(this.valuesArray != undefined) {
        this.synchronous(_.bind(function() { this.render(this.valuesArray); }, this));
      } else {
        // initialize the component only
        this.synchronous(_.bind(this.render, this));
      }
    }
});

var ProtovisComponent =  ChartComponent.extend({

  update : function() {
    if (this.parameters == undefined) {
      this.parameters = [];
    };
    
    this.renderChart();
  },

  render: function(values) {
    $("#" + this.htmlObject).html('<div id="'+ this.htmlObject +'protovis"></div>');
    
    var vis = new pv.Panel()
      .canvas(this.htmlObject + "protovis")
      .width (this.width)
      .height(this.height);
    this.vis = vis;
    this.customfunction(vis, values);
    vis.root.render();
  },

  processdata: function(values) {
    this.render(values);
  }
});

var BaseCccComponent = ChartComponent.extend({
    
    query: null,
    chart: null,
    
    _preProcessChartDefinition: function() {
        var chartDef = this.chartDefinition;
        if(chartDef){
            // Obtain effective compatVersion
            var compatVersion = chartDef.compatVersion;
            if(compatVersion == null){
                compatVersion = typeof pvc.defaultCompatVersion === 'function' ? 
                                pvc.defaultCompatVersion() :
                                1;
            }
            
            if(compatVersion <= 1){
                // Properties that are no more registered in the component
                // and that had a name mapping.
                // The default mapping, for unknown properties, doesn't work.
                if('showLegend' in chartDef){
                    chartDef.legend = chartDef.showLegend;
                    delete chartDef.showLegend;
                }
                
                // Don't presume chartDef props must be own
                for(var p in chartDef){
                    var m = /^barLine(.*)$/.exec(p);
                    if(m){
                        p2 = 'secondAxis' + (m[1] || '');
                        chartDef[p2] = chartDef[p];
                        delete chartDef[p];
                    }
                } 
            }
        }
    }
});

var CccComponent = BaseCccComponent.extend({

    update: function() {
        if(this.parameters == null) {
            this.parameters = [];
        }

        // clear placeholder
        var ph = $("#"+this.htmlObject).empty();
        var me = this;
        
        // Set up defaults for height and width
        if(typeof(this.chartDefinition.width) === "undefined")
            this.chartDefinition.width = ph.width();

        if(typeof(this.chartDefinition.height) === "undefined")
            this.chartDefinition.height = ph.height();
  
        if (typeof Modernizr !== 'undefined' && Modernizr.svg) {
            this.renderChart();
        } else {
            pv.listenForPageLoad(function() {
                me.renderChart();
            });
        }
    },

    render: function(values) {

        $("#" + this.htmlObject).append('<div id="'+ this.htmlObject  +'protovis"></div>');
        
        this._preProcessChartDefinition();
        
        var o = $.extend({},this.chartDefinition);
        o.canvas = this.htmlObject+'protovis';
        // Extension points
        if(typeof o.extensionPoints != "undefined"){
            var ep = {};
            o.extensionPoints.forEach(function(a){
                ep[a[0]]=a[1];
            });
            o.extensionPoints=ep;
        }
        
        this.chart =  new this.cccType(o);
        if(arguments.length > 0){
            this.chart.setData(values,{
                crosstabMode: this.crosstabMode,
                seriesInRows: this.seriesInRows
            });
        }
        this.chart.render();
    }
});


/*
 *   Modified version of CccComponent which loads 2 datasources.
 */
var CccComponent2 = BaseCccComponent.extend({

    query: null,
    sQuery: null,  // second datasource
    chart: null,

    update : function() {

        var dataQuery = null, sDataQuery = null;

        if (this.parameters == undefined) {
            this.parameters = [];
        };

        // clear previous table
        $("#"+this.htmlObject).empty();
        var me = this;


        this.query = Dashboards.getQuery(this.chartDefinition);

        var sQueryDef = $.extend({}, this.chartDefinition);
        sQueryDef.dataAccessId = sQueryDef.structDatasource;
        this.sQuery = Dashboards.getQuery(sQueryDef); 

        var executed = false;
        var execComponent = function() {

            if (   ( dataQuery != null)
                && (sDataQuery != null)
                && !executed) {

                me.render(dataQuery, sDataQuery);
                executed = true;   // safety in case both queries return
            // simultaneously (is this possible in single-threaded Javascript?)
            }

        };

        pv.listenForPageLoad(function() {
            me.query.fetchData(me.parameters, function(values) {
                // why is changedValues a GLOBAL ??  potential conflicts!!
                var changedValues = undefined;
                if((typeof(me.postFetch)=='function')){
                    changedValues = me.postFetch(values);
                    $("#" + this.htmlObject).append('<div id="'+ this.htmlObject  +'protovis"></div>');
                }
                if (changedValues != undefined) {
                    values = changedValues;
                }

                dataQuery = values;        
                execComponent();
            });
        });

        // load the second query (in parallel)
        pv.listenForPageLoad(function() {
            me.sQuery.fetchData(me.parameters, function(values) {
                var changedValues = undefined;
                if((typeof(me.postFetch)=='function')){
                    changedValues = me.postFetch(values);
                    $("#" + this.htmlObject).append('<div id="'+ this.htmlObject  +'protovis"></div>');
                }
                if (changedValues != undefined) {
                    values = changedValues;
                }

                sDataQuery = values;        
                execComponent();
            });
        });
    },

    render: function(values, sValues) {

        $("#" + this.htmlObject).append('<div id="'+ this.htmlObject  +'protovis"></div>');

        this._preProcessChartDefinition();
        
        var o = $.extend({},this.chartDefinition);
        o.canvas = this.htmlObject+'protovis';
        // Extension points
        if(typeof o.extensionPoints != "undefined"){
            var ep = {};
            o.extensionPoints.forEach(function(a){
                ep[a[0]]=a[1];
            });
            o.extensionPoints=ep;
        }
        this.chart =  new this.cccType(o);
        this.chart.setData(values,{
            crosstabMode: this.crosstabMode,
            seriesInRows: this.seriesInRows
        });

        this.chart.setStructData(sValues);
        this.chart.render();
    }

});


var CccAreaChartComponent = CccComponent.extend({

    cccType: pvc.AreaChart

});

var CccStackedDotChart = CccComponent.extend({

    cccType: pvc.StackedDotChart
});

var CccDotChartComponent = CccComponent.extend({

    cccType: pvc.DotChart

});

var CccLineChartComponent = CccComponent.extend({

    cccType: pvc.LineChart

});

var CccStackedLineChartComponent = CccComponent.extend({

    cccType: pvc.StackedLineChart

});

var CccStackedAreaChartComponent = CccComponent.extend({

    cccType: pvc.StackedAreaChart

});

var CccBarChartComponent = CccComponent.extend({

    cccType: pvc.BarChart

});

var CccPieChartComponent = CccComponent.extend({

    cccType: pvc.PieChart

});

var CccHeatGridChartComponent = CccComponent.extend({

    cccType: pvc.HeatGridChart

});

var CccBulletChartComponent = CccComponent.extend({

    cccType: pvc.BulletChart

});

var CccWaterfallChartComponent = CccComponent.extend({

    cccType: pvc.WaterfallChart

});


var CccMetricDotChartComponent = CccComponent.extend({

    cccType: pvc.MetricDotChart

});

var CccMetricLineChartComponent = CccComponent.extend({

    cccType: pvc.MetricLineChart

});


var CccParCoordComponent = CccComponent.extend({

    cccType: pvc.ParallelCoordinates

});

var CccDataTreeComponent = CccComponent2.extend({

    cccType: pvc.DataTree

});

var CccBoxplotChartComponent = CccComponent.extend({

    cccType: pvc.BoxplotChart

});

var CccTreemapChartComponent = CccComponent.extend({

    cccType: pvc.TreemapChart

});

var CccNormalizedBarChartComponent = CccComponent.extend({

    cccType: pvc.NormalizedBarChart

});