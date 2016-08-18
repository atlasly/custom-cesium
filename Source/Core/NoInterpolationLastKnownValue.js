/*global define*/
define([
        './defined',
        './DeveloperError'
    ], function(
        defined,
        DeveloperError) {
    'use strict';

    /**
     * An {@link InterpolationAlgorithm} for performing no interpolation, just take last known value.
     *
     * @exports NoInterpolationLastKnownValue
     */
    var NoInterpolationLastKnownValue = {
        type : 'Linear'
    };

    /**
     * Given the desired degree, returns the number of data points required for interpolation.
     * Since linear interpolation can only generate a first degree polynomial, this function
     * always returns 2.
     * @param {Number} degree The desired degree of interpolation.
     * @returns {Number} This function always returns 2.
     *
     */
    NoInterpolationLastKnownValue.getRequiredDataPoints = function(degree) {
        return 2;
    };

    /**
     * Returns last known value.   No interpolation.
     *
     * @param {Number} x The independent variable for which the dependent variables will be interpolated.
     * @param {Number[]} xTable The array of independent variables to use to interpolate.  The values
     * in this array must be in increasing order and the same value must not occur twice in the array.
     * @param {Number[]} yTable The array of dependent variables to use to interpolate.  For a set of three
     * dependent values (p,q,w) at time 1 and time 2 this should be as follows: {p1, q1, w1, p2, q2, w2}.
     * @param {Number} yStride The number of dependent variable values in yTable corresponding to
     * each independent variable value in xTable.
     * @param {Number[]} [result] An existing array into which to store the result.
     * @returns {Number[]} The array of interpolated values, or the result parameter if one was provided.
     */
    NoInterpolationLastKnownValue.interpolateOrderZero = function(x, xTable, yTable, yStride, result) {
       return yTable[0];
    };

    return NoInterpolationLastKnownValue;
});
