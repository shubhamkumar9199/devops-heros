import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import pytest
from app.calculator import add, subtract, multiply, divide


def test_add():
    assert add(10, 5) == 15


def test_subtract():
    assert subtract(10, 5) == 5


def test_multiply():
    assert multiply(10, 5) == 50


def test_divide():
    assert divide(10, 5) == 2


def test_divide_by_zero():
    with pytest.raises(ValueError):
        divide(10, 0)

@pytest.mark.parametrize("function,a,b,expected", [
    (add, -8, 3, -5),
    (subtract, 2, 7, -5),
    (multiply, 12, 0, 0),
    (divide, 5, 2, 2.5),
])
def test_signed_zero_and_fractional_inputs(function, a, b, expected):
    assert function(a, b) == expected
